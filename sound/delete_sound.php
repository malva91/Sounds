<?php
// delete_sound.php v1.2.0
header('Content-Type: application/json; charset=utf-8');
error_reporting(E_ALL);
ini_set('display_errors', '0');

function svp_log($msg){
  $ts = date('c');
  @file_put_contents(__DIR__.'/svp.log', "[$ts] delete_sound: ".(is_string($msg)?$msg:json_encode($msg))."\n", FILE_APPEND);
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
  
  // Check if file is readable before attempting to delete
  if (!is_readable($filePath)) reply(['success'=>false,'error'=>'FILE_NOT_READABLE'], 403);

  if (!@unlink($filePath)) reply(['success'=>false,'error'=>'UNLINK_FAIL'], 500);

  // Verify file was actually deleted
  if (file_exists($filePath)) {
    svp_log('DELETE_VERIFY_FAIL file still exists');
    reply(['success'=>false,'error'=>'DELETE_VERIFY_FAIL'], 500);
  }

  // Update sounds.json
  $jsonPath = __DIR__ . '/sounds.json';
  if (file_exists($jsonPath)) {
    $raw = @file_get_contents($jsonPath);
    if ($raw !== false) {
      $map = json_decode($raw, true);
      if (is_array($map)) {
        // Store backup for potential rollback
        $backup = isset($map[$filename]) ? $map[$filename] : null;
        unset($map[$filename]);
        
        if (@file_put_contents($jsonPath, json_encode($map, JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT), LOCK_EX) === false) {
          svp_log('JSON_UPDATE_FAIL during delete');
          // Note: File is already deleted, can't rollback file deletion
        }
      }
    }
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
