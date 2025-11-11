<?php
// upload.php v1.2.0
// upload.php — hardened JSON errors + broader MIME + logging
header('Content-Type: application/json; charset=utf-8');
error_reporting(E_ALL);
ini_set('display_errors', '0');

function svp_log($msg){
  $ts = date('c');
  @file_put_contents(__DIR__.'/svp.log', "[$ts] upload: ".(is_string($msg)?$msg:json_encode($msg))."\n", FILE_APPEND);
}
function reply($arr, $http=200){
  http_response_code($http);
  echo json_encode($arr, JSON_UNESCAPED_UNICODE);
  exit;
}
function slugify($text){
  if (function_exists('iconv')) {
    $text = iconv('UTF-8', 'ASCII//TRANSLIT', $text);
  }
  $text = preg_replace('~[^\pL\d]+~u', '-', $text);
  $text = preg_replace('~^-+|-+$~', '', $text);
  $text = strtolower($text);
  $text = preg_replace('~[^-a-z0-9]+~', '', $text);
  return $text ?: 'sound';
}
function random_id($len=8){
  $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  $out = '';
  for($i=0;$i<$len;$i++){
    $idx = function_exists('random_int') ? random_int(0, strlen($alphabet)-1) : mt_rand(0, strlen($alphabet)-1);
    $out .= $alphabet[$idx];
  }
  return $out;
}

try{
  svp_log('BEGIN');

  if ($_SERVER['REQUEST_METHOD'] !== 'POST'){
    reply(['success'=>false,'error'=>'METHOD_NOT_ALLOWED'], 405);
  }

  if (!isset($_FILES['file'])){
    reply(['success'=>false,'error'=>'NO_FILE'], 400);
  }

  // Check if uploads are enabled
  if (ini_get('file_uploads') != 1) {
    reply(['success'=>false,'error'=>'UPLOADS_DISABLED'], 500);
  }

  $maxSize = 200 * 1024 * 1024; // 200MB
  $allowedExt = ['mp3','wav','ogg'];
  $allowedMime = [
    // MP3
    'audio/mpeg','audio/mp3','audio/x-mp3','audio/mpeg3','audio/x-mpeg-3','audio/x-mpeg',
    // WAV
    'audio/wav','audio/x-wav','audio/wave','audio/vnd.wave',
    // OGG
    'audio/ogg','audio/x-ogg','application/ogg'
  ];

  $file = $_FILES['file'];
  if ($file['error'] !== UPLOAD_ERR_OK){
    reply(['success'=>false,'error'=>'UPLOAD_ERROR_'.$file['error']], 400);
  }
  if ($file['size'] > $maxSize){
    reply(['success'=>false,'error'=>'TOO_LARGE'], 413);
  }
  if ($file['size'] === 0){
    reply(['success'=>false,'error'=>'EMPTY_FILE'], 400);
  }

  $label = isset($_POST['label']) ? trim((string)$_POST['label']) : '';
  $label = (function_exists('mb_substr') ? mb_substr(strip_tags($label), 0, 80) : substr(strip_tags($label), 0, 80));
  if ($label === '') {
    reply(['success'=>false,'error'=>'LABEL_REQUIRED'], 400);
  }

  $type = isset($_POST['type']) ? trim((string)$_POST['type']) : 'music';
  if (!in_array($type, ['music', 'effect'], true)) {
    $type = 'music';
  }

  $tagsStr = isset($_POST['tags']) ? (string)$_POST['tags'] : '';
  $tags = array_values(array_filter(array_map(function($s){
    $s = trim($s);
    $s = strip_tags($s);
    $s = (function_exists('mb_substr') ? mb_substr($s, 0, 30) : substr($s, 0, 30));
    return $s === '' ? null : $s;
  }, explode(',', $tagsStr))));
  if (count($tags) > 20) $tags = array_slice($tags, 0, 20);

  $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
  if (!in_array($ext, $allowedExt, true)){
    reply(['success'=>false,'error'=>'EXTENSION_INVALID'], 415);
  }

  if (!class_exists('finfo')){
    reply(['success'=>false,'error'=>'FILEINFO_MISSING'], 500);
  }
  
  if (!is_uploaded_file($file['tmp_name'])){
    reply(['success'=>false,'error'=>'NOT_UPLOADED_FILE'], 400);
  }
  
  $finfo = new finfo(FILEINFO_MIME_TYPE);
  $mime  = $finfo->file($file['tmp_name']);
  if ($mime === false) {
    reply(['success'=>false,'error'=>'MIME_DETECTION_FAIL'], 500);
  }
  
  if (!in_array($mime, $allowedMime, true)){
    svp_log('MIME_FAIL '.$mime);
    reply(['success'=>false,'error'=>'MIME_FAIL_'.$mime], 415);
  }

  $destDir = __DIR__ . '/sounds';

  // Generate filename from original filename
  $originalName = pathinfo($file['name'], PATHINFO_FILENAME);
  $safeName = slugify($originalName) . '.' . $ext;

  // If file exists, add counter instead of random string
  $counter = 1;
  while (file_exists($destDir . '/' . $safeName)) {
    $safeName = slugify($originalName) . '-' . $counter . '.' . $ext;
    $counter++;
  }
  
  if (!is_dir($destDir)) {
    if (!@mkdir($destDir, 0775, true)){
      reply(['success'=>false,'error'=>'MKDIR_FAIL'], 500);
    }
  }
  
  // Check if directory is writable
  if (!is_writable($destDir)) {
    reply(['success'=>false,'error'=>'DIR_NOT_WRITABLE'], 500);
  }
  
  $dest = $destDir . '/' . $safeName;

  // Check if file already exists (very unlikely but possible)
  if (file_exists($dest)) {
    $safeName = slugify($label) . '-' . random_id(12) . '.' . $ext;
    $dest = $destDir . '/' . $safeName;
  }
  
  if (!@move_uploaded_file($file['tmp_name'], $dest)){
    svp_log('MOVE_FAIL '.json_encode(error_get_last()));
    reply(['success'=>false,'error'=>'MOVE_FAIL'], 500);
  }
  
  // Verify file was actually written
  if (!file_exists($dest) || filesize($dest) === 0) {
    svp_log('FILE_VERIFY_FAIL after move');
    reply(['success'=>false,'error'=>'FILE_VERIFY_FAIL'], 500);
  }
  
  @chmod($dest, 0644);

  // Update sounds.json
  $jsonPath = __DIR__ . '/sounds.json';
  $map = [];
  if (file_exists($jsonPath)){
    $raw = @file_get_contents($jsonPath);
    if ($raw === false){
      reply(['success'=>false,'error'=>'JSON_READ_FAIL'], 500);
    }
    $decoded = json_decode($raw, true);
    if ($decoded === null && json_last_error() !== JSON_ERROR_NONE){
      reply(['success'=>false,'error'=>'JSON_DECODE_FAIL: '.json_last_error_msg()], 500);
    }
    if (is_array($decoded)) $map = $decoded;
  }
  
  $map[$safeName] = ['label'=>$label, 'tags'=>$tags, 'type'=>$type];
  
  if (@file_put_contents($jsonPath, json_encode($map, JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT), LOCK_EX) === false){
    // Clean up uploaded file if JSON update fails
    @unlink($dest);
    reply(['success'=>false,'error'=>'JSON_WRITE_FAIL'], 500);
  }
  
  // Verify JSON integrity after write
  $verify = @file_get_contents($jsonPath);
  if ($verify === false || json_decode($verify, true) === null) {
    @unlink($dest); // Clean up
    svp_log('JSON_VERIFY_FAIL after write');
    reply(['success'=>false,'error'=>'JSON_VERIFY_FAIL'], 500);
  }

  svp_log('SUCCESS '.$safeName);
  reply(['success'=>true,'filename'=>$safeName,'label'=>$label,'tags'=>$tags], 200);
}
catch (Throwable $e){
  svp_log('THROW '.$e->getMessage());
  reply(['success'=>false,'error'=>'THROWABLE: '.$e->getMessage()], 500);
}
catch (Exception $e){
  svp_log('EXC '.$e->getMessage());
  reply(['success'=>false,'error'=>'EXCEPTION: '.$e->getMessage()], 500);
}
