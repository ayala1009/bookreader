const AUTO_STATUS=Object.freeze({off:'自动拍摄已关闭',idle:'请先开启相机',moving:'画面移动中',waiting:'等待画面稳定',captured:'已拍摄，请移动或翻页',invalid:'未确认书页，请调整位置'});
window.AUTO_STATUS=AUTO_STATUS;
class PageStabilityGate {
  constructor(config=PAGE_CONFIG) {this.config=config;this.reset();}
  reset() {this.previous=null;this.anchor=null;this.since=null;this.last=null;this.captured=null;}
  static delta(a,b) {
    if(!a||!b||a.length!==b.length) return {boundary:Infinity,texture:Infinity};
    let boundary=0,sum=0,n=0;
    a.forEach((p,i)=>{p.points.forEach((v,j)=>{boundary=Math.max(boundary,pageDistance(v,b[i].points[j]));});
      if(p.content&&b[i].content){sum+=comparePageContent(p.content,b[i].content).distance*20;n++;}
      else p.signature.forEach((v,j)=>{sum+=Math.abs(v-b[i].signature[j]);n++;});});
    return {boundary,texture:sum/Math.max(1,n)};
  }
  update(pages,now) {
    if(!pages.length) {this.previous=this.anchor=null;this.since=null;this.last=now;return {status:AUTO_STATUS.invalid};}
    const gap=this.last===null||now-this.last>this.config.interval*3;
    this.last=now;
    const same=d=>d.boundary<=this.config.boundaryTolerance&&d.texture<=this.config.textureTolerance;
    if(this.captured&&same(PageStabilityGate.delta(pages,this.captured))) {
      this.previous=pages;this.anchor=null;this.since=null;return {status:AUTO_STATUS.captured};
    }
    const stable=!gap&&same(PageStabilityGate.delta(pages,this.previous))&&(!this.anchor||same(PageStabilityGate.delta(pages,this.anchor)));
    this.previous=pages;
    if(!stable) {this.anchor=pages;this.since=now;return {status:AUTO_STATUS.moving};}
    this.since??=now;
    return {status:AUTO_STATUS.waiting,shoot:now-this.since>=this.config.stableMs};
  }
  commit(pages) {this.captured=pages;this.since=null;this.anchor=null;}
}
class StabilityDetector {
  constructor(video,{onStatus,onStable,onError,onPages=()=>{},onIdentity=()=>{}}) {
    Object.assign(this,{video,onStatus,onStable,onError,onPages,onIdentity});
    this.engine=new BookPageDetector();this.gate=new PageStabilityGate();this.generation=0;this.pages=[];
    this.tracker=new PageContentTracker();
  }
  start() {
    this.stop();const generation=this.generation;
    this.onStatus('正在加载书页检测…');
    const tick=async()=>{
      if(generation!==this.generation) return;
      try {
        const detected=this.video.readyState>=2?this.engine.detect(this.video):[];
        const pages=samplePageContents(this.engine,detected);
        this.pages=pages;this.onPages(pages,this.engine.diagnostics,{stats:this.engine.stats,thumbnail:this.engine.debugCanvas});
        const now=performance.now();
        if(this.tracker.handOccluded)this.gate.reset();
        const result=this.gate.update(pages,now);
        const identity=this.tracker.observe(pages,now,!!result.shoot);
        this.onStatus(identity.status);this.onIdentity(identity.status);
        if(identity.capture) {
          const ok=await this.onStable(pages);
          if(generation!==this.generation)return;
          if(ok) {this.onStatus('新页面已采集');this.onIdentity('新页面已采集');}
        }
      } catch(error) {this.stop();this.onError(error);return;}
      if(generation===this.generation)this.timer=setTimeout(tick,PAGE_CONFIG.interval);
    };
    this.engine.ready().then(()=>{if(generation===this.generation)tick();}).catch(error=>{if(generation===this.generation){this.stop();this.onError(error);}});
  }
  stop() {this.generation++;clearTimeout(this.timer);this.pages=[];this.gate.reset();this.tracker.pause();this.onPages([]);}
}
window.StabilityDetector=StabilityDetector;
window.PageStabilityGate=PageStabilityGate;
