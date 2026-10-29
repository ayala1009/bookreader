const $ = id => document.getElementById(id);
const camera = new BookCamera($('video'));
let state = 'idle';
let operation = 0;
let photoURL = null;
const detector = new StabilityDetector($('video'), {
  onStatus: text => { $('stability-status').textContent = text; },
  onStable: () => takePhoto(true),
  onError: error => { message('???????' + error.message, true); }
});
function syncDetection() {
  detector.stop();
  if ($('auto').checked && state === 'live' && !document.hidden) detector.start();
  else $('stability-status').textContent = $('auto').checked ? '??????' : '???????';
}
$('auto').addEventListener('change', syncDetection);

function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function render(next) {
  state = next;
  $('start').hidden = !['idle', 'starting'].includes(next);
  $('start').disabled = next === 'starting';
  $('start').textContent = next === 'starting' ? '正在开启…' : '开启相机';
  $('capture').hidden = !['live', 'capturing'].includes(next);
  $('capture').disabled = next !== 'live';
  $('stop').hidden = !['starting', 'live', 'capturing'].includes(next);
  $('retake').hidden = next !== 'result';
  $('download').hidden = !photoURL;
  $('video').hidden = !['starting', 'live', 'capturing'].includes(next);
  $('result').hidden = !photoURL;
  $('placeholder').hidden = next !== 'idle';
  $('phase').textContent = { idle: '相机未开启', starting: '等待相机', live: '实时画面', capturing: '正在生成照片', result: '拍摄完成 · 相机已释放' }[next];
  if (['idle', 'starting'].includes(next)) $('resolution').textContent = '实际分辨率：—';
}
function clearPhoto() {
  $('result').removeAttribute('src');
  $('download').removeAttribute('href');
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = null;
}
function explain(error) {
  const errors = {
    NotAllowedError: '摄像头权限被拒绝或被系统限制。请在 Safari 的网站设置中允许使用摄像头，再点击“开启相机”。',
    NotFoundError: '没有找到可用摄像头，请确认设备带有摄像头且已连接。',
    NotReadableError: '无法读取摄像头，可能正被其他应用占用。请关闭占用相机的应用后重试。',
    OverconstrainedError: '设备无法满足摄像头要求，请更换浏览器或设备后重试。',
    SecurityError: '相机被安全设置限制。请使用 Safari 直接打开 HTTPS 页面，并检查网站相机权限。',
    AbortError: '相机操作已中断，请重新开启相机。'
  };
  return errors[error.name] || error.message || '相机操作失败，请重试。';
}
async function start() {
  const token = ++operation;
  detector.stop();
  clearPhoto();
  render('starting');
  message('请允许使用摄像头，优先请求后置摄像头。');
  try {
    await camera.start();
    if (token !== operation) return;
    render('live');
    updateResolution();
    syncDetection();
    camera.stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (state === 'live' || state === 'capturing') stop('摄像头连接已中断，请重新开启相机。');
    }));
    message('请确认整张书页都在画面内，保持手机稳定后拍摄。');
  } catch (error) {
    if (token !== operation) return;
    render('idle');
    message(explain(error), true);
  }
}
function stop(text = '相机已停止，摄像头资源已释放。') {
  ++operation;
  detector.stop();
  camera.stop();
  render('idle');
  syncDetection();
  message(text);
}
function updateResolution() {
  if (state !== 'live') return;
  const { width, height } = camera.dimensions;
  $('resolution').textContent = `实际视频：${width} × ${height} px`;
}
$('start').addEventListener('click', start);
$('retake').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('video').addEventListener('resize', updateResolution);
$('capture').addEventListener('click', () => takePhoto(false));
async function takePhoto(automatic = false) {
  if (state !== 'live') return;
  const token = ++operation;
  if (!automatic) detector.stop();
  render('capturing');
  try {
    const photo = await camera.capture();
    if (token !== operation) return;
    clearPhoto();
    photoURL = URL.createObjectURL(photo.blob);
    $('result').src = $('download').href = photoURL;
    $('download').download = `book-page-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    if (!automatic) camera.stop();
    render(automatic ? 'live' : 'result');
    $('resolution').textContent = `照片：${photo.width} × ${photo.height} px`;
    message('完整画面已保存到预览，可下载或重新拍摄。');
    // Integration point: event.detail = { blob, width, height }. No upload is performed.
    window.dispatchEvent(new CustomEvent('bookreader:captured', { detail: photo }));
  } catch (error) {
    if (token !== operation) return;
    render('live');
    message(explain(error), true);
    if (!automatic) syncDetection();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['starting', 'live', 'capturing'].includes(state)) stop('页面已进入后台，相机已释放。返回后请重新开启相机。');
});
window.addEventListener('pagehide', () => {
  if (state !== 'result') stop();
  else camera.stop();
});
render('idle');
if (!window.isSecureContext) message('当前不是安全连接，请使用 HTTPS 页面。手机无法通过电脑的 HTTP 局域网地址开启相机。', true);
