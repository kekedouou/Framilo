'use strict';
const assert=require('assert'),{harness,memoryStore}=require('./drawing-session.cjs');
const shape=[{id:'line',kind:'pen',color:'#ffffff',width:.004,points:[{x:.2,y:.2},{x:.5,y:.5}]}];
(async()=>{
 const store=memoryStore(),h=harness(store);await h.load();await h.session.beginDrawing('native');h.session.setDrawingObjects(shape);await h.session.saveDrawing();
 // A newly added text is absent from stored links but still owns the same source frame.
 h.native.push({id:'later',duration:.04,annotation:'后来添加'});await h.session.refreshComments();await h.session.deleteComment('native');await h.session.saveComment();assert.equal(h.session.snapshot().drawings.records.length,1);assert.equal(h.session.snapshot().drawings.records[0].nativeLinks[0].id,'later');
 await h.session.deleteComment('later');store.fail=true;await h.session.saveComment();assert.equal(h.session.snapshot().drawings.records.length,1);assert(!h.session.snapshot().comments.draft);assert(h.session.snapshot().comments.message.includes('仍保留'));const writes=h.writes;store.fail=false;
 const orphan=h.session.snapshot().comments.items.find(n=>n.localDrawing);assert(orphan);await h.session.beginDrawing(orphan.id,'delete');await h.session.saveDrawing();assert.equal(h.writes,writes);assert.equal(h.session.snapshot().drawings.records.length,0);await h.session.close();
 const reopened=harness(store);reopened.native=[];await reopened.load();assert.equal(reopened.session.snapshot().drawings.records.length,0);await reopened.session.close();
 const u=harness(memoryStore(),{unknownDelete:true});await u.load();await u.session.beginDrawing('native');u.session.setDrawingObjects(shape);await u.session.saveDrawing();await u.session.deleteComment('native');await u.session.saveComment();assert.equal(u.session.snapshot().drawings.records.length,1);const count=u.writes;await u.session.checkComment();assert.equal(u.writes,count);assert.equal(u.session.snapshot().drawings.records.length,1);await u.session.close();
 console.log('E28 deletion: late shared text, partial failure, local retry, restart and uncertain delete protection passed; isolated model only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
