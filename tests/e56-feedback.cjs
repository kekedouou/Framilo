'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const index=require('../plugin/frame-index.cjs'),{defaultQuality,interactionValue}=require('../plugin/preferences.cjs');
const {harness,flush}=require('./timeline-ui.cjs');
require('../plugin/graphite-shell.js');
test('nearest source PTS uses VFR gaps and keeps playback containment separate',()=>{
 const frames=[0,.04,.09,.3,.3,.7].map(time=>({time}));
 for(const [time,expected]of [[-1,0],[.025,1],[.065,1],[.08,2],[.22,3],[.3,4],[.55,5],[1,5]])assert.equal(index.nearestFrame(frames,time),expected);
 assert.equal(index.frameAt(frames,.025),0);assert.equal(index.frameAt(frames,.55),4);
 assert.throws(()=>index.nearestFrame([],0));assert.throws(()=>index.nearestFrame(frames,NaN));
});
test('timeline cursor uses the chosen ordinal before seek and stays there on release/late completion',async()=>{
 const h=harness(),resolves=[];
 h.session.seek=(time,options)=>{h.calls.push(['seek',time,options]);assert.equal(parseFloat(h.el('thumb').style.left),time*10);return new Promise(resolve=>resolves.push(()=>{h.state.playback.time=time;h.state.playback.frameOrdinal=options.index;h.update();resolve({status:'drawn'});}));};
 h.el('timeline').fire('pointerdown',{clientX:338.4}); // 2.98s, nearest 3.0s.
 assert.equal(h.calls.at(-1)[1],3);assert.equal(h.calls.at(-1)[2].index,30);
 h.win.fire('pointermove',{clientX:345.6}); // 3.07s, nearest 3.1s.
 h.win.fire('pointerup',{clientX:345.6,buttons:0});
 assert.equal(h.calls.at(-1)[2].index,31);assert.equal(parseFloat(h.el('thumb').style.left),31);
 resolves[0]();await flush();assert.equal(parseFloat(h.el('thumb').style.left),31);
 resolves.at(-1)();await flush();assert.equal(parseFloat(h.el('thumb').style.left),31);h.ui.destroy();
});
test('loop status changes after first drag, without instruction paragraphs',async()=>{
 const h=harness();h.state.playback.transport.loop={valid:false,enabled:false};h.update();h.key('R');h.up('R');await flush();
 assert.equal(h.el('loopHelp').textContent,'请拖动起点');
 h.el('timeline').fire('pointerdown',{clientX:180});assert.equal(h.el('loopHelp').textContent,'请拖动起点');
 h.win.fire('pointerup',{clientX:260,buttons:0});await flush();assert.equal(h.el('loopHelp').textContent,'请拖动终点');
 h.el('timeline').fire('pointerdown',{clientX:420});h.win.fire('pointerup',{clientX:500,buttons:0});await flush();assert(h.el('loopHelp').hidden);
 h.key('Escape');assert(h.el('loopHelp').hidden);h.ui.destroy();
});
test('loop-focused pointer targets stop at both inclusive endpoints, including view padding',async()=>{
 const h=harness(true);
 for(const [x,ordinal]of [[0,20],[100,20],[5000,40],[900,40]]){h.el('timeline').fire('pointerdown',{clientX:x});h.win.fire('pointerup',{clientX:x,buttons:0});await flush();assert.equal(h.calls.filter(c=>c[0]==='seek').at(-1)[2].index,ordinal);assert.equal(h.state.playback.frameOrdinal,ordinal);}
 h.key('R');h.hold();await flush();h.el('timeline').fire('pointerdown',{clientX:820,target:h.el('loopHandleEnd')});h.win.fire('pointerup',{clientX:820,buttons:0});await flush();assert.equal(h.calls.filter(c=>c[0]==='seek').at(-1)[2].index,90);h.key('Escape');h.ui.destroy();
});
test('record/settings shortcuts toggle once and preserve typing, modifiers, repeats and drafts',()=>{
 let records=0,settings=0;const shell={update(){},destroy(){},blocked:()=>false,records(){records++;},settings(){settings++;}};
 const h=harness(false,shell);h.key('B');h.key('O');assert.equal(records,1);assert.equal(settings,1);
 for(const extra of [{repeat:true},{ctrlKey:true},{shiftKey:true},{isComposing:true},{target:{closest:()=>({type:'text'})}}]){h.key('B',extra);h.key('O',extra);}
 assert.equal(records,1);assert.equal(settings,1);h.state.drawings={draft:{status:'editing'}};h.update();h.key('B');h.key('O');assert.equal(records,1);assert.equal(settings,1);h.ui.destroy();
});
test('first quality follows physical screen short edge; toolbar is opt-out',()=>{
 for(const [display,q]of [[undefined,'1080p'],[{width:1920,height:1080},'1080p'],[{width:2560,height:1440},'1440p'],[{width:1280,height:720,scaleFactor:2},'1440p'],[{width:3840,height:2160},'2160p'],[{width:1440,height:2560},'1440p'],[{width:0,height:NaN},'1080p']])assert.equal(defaultQuality(display),q);
 assert.equal(interactionValue().drawingToolbar,true);assert.equal(interactionValue(1,false,.1,.25,false).drawingToolbar,false);
});
test('record edit entry matches exit duration, cancels on reopen and honours reduced motion',()=>{
 let reduced=false,calls=0;const editor={isConnected:true,hidden:false,animate(frames,options){calls++;const value={frames,options,cancel(){this.cancelled=true;}};this.last=value;return value;}};
 const motion=globalThis.EVAGraphite.createEditorEnter({matchMedia:()=>({matches:reduced})});motion.start(editor);
 assert.equal(editor.last.options.duration,140);assert.equal(editor.last.frames[0].transform,'translateY(6px)');
 const first=editor.last;motion.start(editor);assert(first.cancelled);motion.cancel();assert(editor.last.cancelled);
 reduced=true;motion.start(editor);assert.equal(calls,2);reduced=false;editor.hidden=true;motion.start(editor);assert.equal(calls,2);
});
