<?php
// list_sounds.php v1.2.0
// list_sounds.php — hardened with explicit JSON errors + logging
header('Content-Type: application/json; charset=utf-8');

// Robust error reporting to log, not to output
error_reporting(E_ALL);
ini_set('display_errors', '0');

function svp_log($msg){
  $ts = date('c');
  @file_put_contents(__DIR__.'/svp.log', "[$ts] list_sounds: ".(is_string($msg)?$msg:json_encode($msg))."\n", FILE_APPEND);
}

try{
  svp_log('BEGIN');

  $dir = __DIR__ . '/sounds';
  $valid = array('mp3','wav','ogg');

  if (!is_dir($dir)){
    http_response_code(500);
    svp_log('DIR_MISSING '.$dir);
    echo json_encode(array('success'=>false,'error'=>'DIR_MISSING: cartella sounds non trovata'));
    exit;
  }

  // Load sounds.json if present
  $map = array();
  $jsonPath = __DIR__ . '/sounds.json';
  if (file_exists($jsonPath)) {
    $raw = @file_get_contents($jsonPath);
    if ($raw === false){
      http_response_code(500);
      svp_log('JSON_READ_FAIL');
      echo json_encode(array('success'=>false,'error'=>'JSON_READ_FAIL: impossibile leggere sounds.json'));
      exit;
    }
    $decoded = json_decode($raw, true);
    if ($decoded === null && json_last_error() !== JSON_ERROR_NONE){
      http_response_code(500);
      svp_log('JSON_DECODE_FAIL: '.json_last_error_msg());
      echo json_encode(array('success'=>false,'error'=>'JSON_DECODE_FAIL: '.json_last_error_msg()));
      exit;
    }
    if (is_array($decoded)) $map = $decoded;
  }

  $items = array();
  $dh = @opendir($dir);
  if ($dh === false){
    http_response_code(500);
    svp_log('OPENDIR_FAIL');
    echo json_encode(array('success'=>false,'error'=>'OPENDIR_FAIL: impossibile aprire sounds/'));
    exit;
  }

  while (($file = readdir($dh)) !== false){
    if ($file === '.' || $file === '..') continue;
    if (strpos($file, '.') === 0) continue; // Skip hidden files
    if (strpos($file, '.htaccess') !== false) continue; // Skip .htaccess
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if (!in_array($ext, $valid, true)) continue;
    $path = $dir . '/' . $file;
    $mtime = @filemtime($path);
    if ($mtime === false) $mtime = 0;
    $size = @filesize($path);
    if ($size === false || $size === 0) continue; // Skip empty/corrupted files
    
    // Ensure file is readable
    if (!is_readable($path)) continue;
    
    $meta = isset($map[$file]) ? $map[$file] : array('label'=>pathinfo($file, PATHINFO_FILENAME), 'tags'=>array());
    $label = isset($meta['label']) && $meta['label'] !== '' ? $meta['label'] : pathinfo($file, PATHINFO_FILENAME);
    $tags  = isset($meta['tags']) && is_array($meta['tags']) ? $meta['tags'] : array();

    $items[] = array('filename'=>$file, 'label'=>$label, 'tags'=>$tags, 'mtime'=>$mtime, 'size'=>$size);
  }
  closedir($dh);

  usort($items, function($a,$b){
    if ($a['mtime']==$b['mtime']) return 0;
    return ($a['mtime'] < $b['mtime']) ? 1 : -1;
  });

  svp_log('SUCCESS count='.count($items));
  echo json_encode($items, JSON_UNESCAPED_UNICODE);
  
} catch (Throwable $e){
  http_response_code(500);
  svp_log('THROWABLE '.$e->getMessage());
  echo json_encode(array('success'=>false,'error'=>'THROWABLE: '.$e->getMessage()));
} catch (Exception $e){
  http_response_code(500);
  svp_log('EXCEPTION '.$e->getMessage());
  echo json_encode(array('success'=>false,'error'=>'EXCEPTION: '.$e->getMessage()));
}
