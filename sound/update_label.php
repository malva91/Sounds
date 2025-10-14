<?php
// update_label.php v1.2.0
header('Content-Type: application/json; charset=utf-8');
error_reporting(E_ALL);
ini_set('display_errors', '0');

function svp_log($msg){
  $ts = date('c');
  @file_put_contents(__DIR__.'/svp.log', "[$ts] update_label: ".(is_string($msg)?$msg:json_encode($msg))."\n", FILE_APPEND);
}
function reply($arr, $http=200){
  http_response_code($http);
  echo json_encode($arr, JSON_UNESCAPED_UNICODE);
  exit;
}
function sanitize_filename($name){
  $name = basename($name);
  // allow only safe chars
  return preg_replace('/[^A-Za-z0-9._-]/', '_', $name);
}

try{
  svp_log('BEGIN');

  if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(['success'=>false,'error'=>'METHOD_NOT_ALLOWED'], 405);
  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);
  if (!is_array($data)) reply(['success'=>false,'error'=>'INVALID_JSON'], 400);

  $filename = isset($data['filename']) ? sanitize_filename((string)$data['filename']) : '';
  if ($filename === '') reply(['success'=>false,'error'=>'FILENAME_MISSING'], 400);

  // Additional filename validation
  if (strpos($filename, '..') !== false || strpos($filename, '/') !== false) {
    reply(['success'=>false,'error'=>'INVALID_FILENAME'], 400);
  }

  $filePath = __DIR__ . '/sounds/' . $filename;
  if (!is_file($filePath)) reply(['success'=>false,'error'=>'FILE_NOT_FOUND'], 404);
  
  // Check if file is readable
  if (!is_readable($filePath)) reply(['success'=>false,'error'=>'FILE_NOT_READABLE'], 403);

  $label = isset($data['label']) ? strip_tags(trim((string)$data['label'])) : '';
  if ($label === '') reply(['success'=>false,'error'=>'LABEL_MISSING'], 400);
  $label = function_exists('mb_substr') ? mb_substr($label, 0, 80) : substr($label, 0, 80);

  $type = isset($data['type']) ? trim((string)$data['type']) : 'music';
  if (!in_array($type, ['music', 'effect'], true)) {
    $type = 'music';
  }

  $tags = isset($data['tags']) && is_array($data['tags']) ? $data['tags'] : [];

  // Better tag processing
  $tags = array_values(array_filter(array_map(function($s){
    $s = strip_tags(trim((string)$s));
    $s = preg_replace('/[^\p{L}\p{N}\s\-_]/u', '', $s); // Allow only letters, numbers, spaces, hyphens, underscores
    $s = function_exists('mb_substr') ? mb_substr($s, 0, 30) : substr($s, 0, 30);
    return $s === '' ? null : $s;
  }, $tags)));

  if (count($tags) > 20) $tags = array_slice($tags, 0, 20);

  // Update sounds.json
  $jsonPath = __DIR__ . '/sounds.json';
  $map = [];
  if (file_exists($jsonPath)) {
    $raw = @file_get_contents($jsonPath);
    if ($raw === false) reply(['success'=>false,'error'=>'JSON_READ_FAIL'], 500);
    $decoded = json_decode($raw, true);
    if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) reply(['success'=>false,'error'=>'JSON_DECODE_FAIL: '.json_last_error_msg()], 500);
    if (is_array($decoded)) $map = $decoded;
  }
  
  // Store original data for rollback
  $originalData = isset($map[$filename]) ? $map[$filename] : null;
  
  $map[$filename] = ['label'=>$label, 'tags'=>$tags, 'type'=>$type];
  
  if (@file_put_contents($jsonPath, json_encode($map, JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT), LOCK_EX) === false){
    reply(['success'=>false,'error'=>'JSON_WRITE_FAIL'], 500);
  }
  
  // Verify JSON integrity after write
  $verify = @file_get_contents($jsonPath);
  $verifyDecoded = json_decode($verify, true);
  if ($verify === false || $verifyDecoded === null || !isset($verifyDecoded[$filename])) {
    // Attempt rollback
    if ($originalData !== null) {
      $map[$filename] = $originalData;
    } else {
      unset($map[$filename]);
    }
    @file_put_contents($jsonPath, json_encode($map, JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT), LOCK_EX);
    
    svp_log('JSON_INTEGRITY_FAIL after update');
    reply(['success'=>false,'error'=>'JSON_INTEGRITY_FAIL'], 500);
  }
  
  svp_log('SUCCESS '.$filename);
  reply(['success'=>true], 200);

} catch (Throwable $e){
  svp_log('THROW '.$e->getMessage());
  reply(['success'=>false,'error'=>'THROWABLE: '.$e->getMessage()], 500);
} catch (Exception $e){
  svp_log('EXC '.$e->getMessage());
  reply(['success'=>false,'error'=>'EXCEPTION: '.$e->getMessage()], 500);
}
