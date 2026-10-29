/* Conservative document heuristics, not a semantic book classifier. */
const PAGE_CONFIG = Object.freeze({ interval: 350, maxSide: 640, stableMs: 1500,
  boundaryTolerance: .012, textureTolerance: 4, minArea: .07, maxCandidates: 10 });
const pageDistance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
function orderPage(points) {
  const sorted = [...points].sort((a,b) => a.y-b.y);
  const top = sorted.slice(0,2).sort((a,b) => a.x-b.x);
  const bottom = sorted.slice(2).sort((a,b) => a.x-b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}
function pageWarp(cv, src, points, width, height) {
  const objects = [];
  try {
    const a = cv.matFromArray(4,1,cv.CV_32FC2,points.flatMap(p=>[p.x,p.y])); objects.push(a);
    const b = cv.matFromArray(4,1,cv.CV_32FC2,[0,0,width-1,0,width-1,height-1,0,height-1]); objects.push(b);
    const matrix = cv.getPerspectiveTransform(a,b); objects.push(matrix);
    const output = new cv.Mat(); objects.push(output);
    cv.warpPerspective(src,output,matrix,new cv.Size(width,height),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
    return { image: output.clone(), matrix: Array.from(matrix.data64F) };
  } finally { objects.reverse().forEach(x=>x.delete()); }
}

class BookPageDetector {
  constructor() { this.canvas = document.createElement('canvas'); }
  async ready() { this.cv = await loadBookCV(); }
  detect(source) {
    const cv = this.cv;
    if (!cv) throw new Error('OpenCV 尚未就绪');
    const w = source.videoWidth || source.width, h = source.videoHeight || source.height;
    const scale = PAGE_CONFIG.maxSide / Math.max(w,h);
    this.canvas.width = Math.round(w*scale); this.canvas.height = Math.round(h*scale);
    this.canvas.getContext('2d').drawImage(source,0,0,this.canvas.width,this.canvas.height);
    const objects=[];
    const own=x=>(objects.push(x),x);
    try {
      const src=own(cv.imread(this.canvas)), gray=own(new cv.Mat()), edges=own(new cv.Mat());
      cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray,edges,new cv.Size(5,5),0);
      cv.Canny(edges,edges,45,130);
      const kernel=own(cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3)));
      cv.morphologyEx(edges,edges,cv.MORPH_CLOSE,kernel);
      const contours=own(new cv.MatVector()), hierarchy=own(new cv.Mat());
      cv.findContours(edges,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
      const quads=[];
      for(let i=0;i<contours.size();i++) {
        const contour=contours.get(i), approx=new cv.Mat();
        try {
          const area=Math.abs(cv.contourArea(contour));
          if(area < gray.cols*gray.rows*PAGE_CONFIG.minArea || area>gray.cols*gray.rows*.93) continue;
          cv.approxPolyDP(contour,approx,.025*cv.arcLength(contour,true),true);
          if(approx.rows!==4 || !cv.isContourConvex(approx)) continue;
          const points=orderPage(Array.from({length:4},(_,j)=>({x:approx.data32S[j*2],y:approx.data32S[j*2+1]})));
          if(points.some(p=>p.x<4||p.y<4||p.x>gray.cols-5||p.y>gray.rows-5)) continue;
          const pw=(pageDistance(points[0],points[1])+pageDistance(points[3],points[2]))/2;
          const ph=(pageDistance(points[0],points[3])+pageDistance(points[1],points[2]))/2;
          if(pw/ph<.4 || pw/ph>2.4) continue;
          quads.push({points,area,ratio:pw/ph});
        } finally { contour.delete(); approx.delete(); }
      }
      quads.sort((a,b)=>b.area-a.area);
      const candidates=[];
      for(const quad of quads.slice(0,PAGE_CONFIG.maxCandidates)) {
        if(candidates.some(c=>pageDistance(c.points[0],quad.points[0])<12)) continue;
        const warped=pageWarp(cv,gray,quad.points,240,320);
        try {
          const full=warped.image;
          if(quad.ratio>1.12) {
            const seam=this.findSeam(full);
            if(seam!==null) {
              const t=seam/full.cols, p=quad.points;
              const lerp=(a,b)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
              const top=lerp(p[0],p[1]), bottom=lerp(p[3],p[2]);
              for(const [label,points] of [['左页',[p[0],top,bottom,p[3]]],['右页',[top,p[1],p[2],bottom]]]) {
                const part=pageWarp(cv,gray,points,160,220);
                try { const evidence=this.texture(part.image); if(evidence.valid) candidates.push({points,label,evidence,seam:true}); }
                finally { part.image.delete(); }
              }
            }
          } else {
            const evidence=this.texture(full);
            if(evidence.valid) candidates.push({...quad,label:'单页',evidence});
          }
        } finally { warped.image.delete(); }
      }
      // Keep distinct page regions; do not return nested duplicate contours.
      const accepted=[];
      for(const c of candidates) {
        const center=c.points.reduce((s,p)=>({x:s.x+p.x/4,y:s.y+p.y/4}),{x:0,y:0});
        if(accepted.some(a=>pageDistance(a.center,center)<Math.min(gray.cols,gray.rows)*.18)) continue;
        accepted.push({...c,center});
        if(accepted.length===2) break;
      }
      accepted.sort((a,b)=>a.center.x-b.center.x);
      if(accepted.length===2) {
        const [a,b]=accepted;
        const ha=(pageDistance(a.points[0],a.points[3])+pageDistance(a.points[1],a.points[2]))/2;
        const hb=(pageDistance(b.points[0],b.points[3])+pageDistance(b.points[1],b.points[2]))/2;
        // Independent contours must plausibly share a binding, not just be two rectangles.
        const adjoining=(pageDistance(a.points[1],b.points[0])+pageDistance(a.points[2],b.points[3]))/2;
        if(Math.min(ha,hb)/Math.max(ha,hb)<.7 || adjoining>Math.min(ha,hb)*.18 || Math.abs(a.center.y-b.center.y)>Math.min(ha,hb)*.18) {
          accepted.splice(1);accepted[0].label='单页';
        }
      }
      if(accepted.length===2) { accepted[0].label='左页'; accepted[1].label='右页'; }
      return accepted.map(c=>({label:c.label, points:c.points.map(p=>({x:p.x/gray.cols,y:p.y/gray.rows})),
        signature:c.evidence.signature, evidence:{contour:true,texture:true,seam:!!c.seam}, confidence:'heuristic'}));
    } finally { objects.reverse().forEach(x=>x.delete()); }
  }
  texture(mat) {
    const w=mat.cols,h=mat.rows,d=mat.data, rows=[]; let dark=0,total=0, transitions=0;
    const signature=[];
    // Text-like small horizontal runs on several separated lines, spread across page.
    let activeBands=0, previous=false;
    for(let y=Math.floor(h*.12);y<h*.88;y++) {
      let ink=0,runs=0,run=0;
      for(let x=Math.floor(w*.12);x<w*.88;x++) {
        const local=d[y*w+x]<155;
        if(local) { ink++;run++; } else if(run) { if(run>=1&&run<w*.09) runs++; run=0; }
        dark+=Number(local); total++;
        if(x>1) transitions+=Number(Math.abs(d[y*w+x]-d[y*w+x-1])>35);
      }
      const line=ink>w*.025&&ink<w*.48&&runs>=4;
      if(line&&!previous) activeBands++;
      previous=line; rows.push(line);
    }
    for(let gy=0;gy<16;gy++) for(let gx=0;gx<12;gx++) {
      let sum=0,count=0;
      for(let y=Math.floor((.1+gy*.8/16)*h);y<(.1+(gy+1)*.8/16)*h;y++)
        for(let x=Math.floor((.1+gx*.8/12)*w);x<(.1+(gx+1)*.8/12)*w;x++) {sum+=d[y*w+x];count++;}
      signature.push(sum/Math.max(count,1));
    }
    return {valid:activeBands>=5&&dark/total>.025&&dark/total<.38&&transitions/total>.025,signature};
  }
  findSeam(mat) {
    const w=mat.cols,h=mat.rows,d=mat.data; let best=null,score=0;
    for(let x=Math.floor(w*.38);x<w*.62;x++) {
      let support=0,contrast=0;
      for(let y=Math.floor(h*.08);y<h*.92;y++) {
        const v=d[y*w+x], outer=(d[y*w+x-12]+d[y*w+x+12])/2;
        if(outer-v>12) support++;
        contrast+=outer-v;
      }
      if(support/(h*.84)>.65&&contrast>score) {score=contrast;best=x;}
    }
    return best;
  }
}
window.BookPageDetector=BookPageDetector;
window.pageWarp=pageWarp;
