'use strict';
// Window geometry only; media pixels and frame coordinates remain unchanged.
function fitBounds(video, bounds, area, chrome = 112) {
  const ratio = video.width / video.height;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
  const maxW = Math.max(1, area.width - 32), maxH = Math.max(1, area.height - 32 - chrome);
  let width = Math.min(1120, maxW, maxH * ratio);
  if (ratio < 1) width = Math.min(width, 788 * ratio);
  const height = Math.round(width / ratio + chrome);
  width = Math.round(width);
  return {width, height,
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, bounds.x + (bounds.width - width) / 2))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, bounds.y + (bounds.height - height) / 2)))};
}
function createWindowFit({host,screen,report=()=>{}}) {
  let source=null,sequence=0,disposed=false,attempted=false;
  return {
    update(s) {
      const key=s.source && [s.source.libraryId,s.source.id,s.source.filePath].join(':');
      if(disposed)return;
      if(key!==source){source=key;sequence++;attempted=false;}
      if(!key||attempted||!s.preview?.width||!s.preview?.height||!host?.setBounds||!screen?.getDisplayNearestPoint)return;
      attempted=true;const token=sequence;
      return (async()=>{
        const [full,max,bounds]=await Promise.all([host.isFullScreen(),host.isMaximized(),host.getBounds()]);
        if(full||max||disposed||token!==sequence)return;
        const display=await screen.getDisplayNearestPoint({x:Math.round(bounds.x+bounds.width/2),y:Math.round(bounds.y+bounds.height/2)});
        if(disposed||token!==sequence)return;
        const fitted=fitBounds(s.preview,bounds,display.workArea);
        // A user may maximize or start resizing while discovery is in flight.
        const [current,nowFull,nowMax]=await Promise.all([host.getBounds(),host.isFullScreen(),host.isMaximized()]);
        if(disposed||token!==sequence||nowFull||nowMax||Object.keys(bounds).some(k=>current[k]!==bounds[k]))return;
        if(fitted)await host.setBounds(fitted);
      })().catch(report);
    },
    destroy(){disposed=true;sequence++;}
  };
}
module.exports={fitBounds,createWindowFit};
