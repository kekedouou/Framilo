//! NOTE-02 independent, explicitly authorized Windows IMM cancellation probe.
//! No plugin integration, injection, input synthesis, settings or annotation I/O.
//! Usage: probe inspect|cancel <observed HWND decimal>. Only foreground Framilo/Eagle.
#![no_std]
#![no_main]
use core::{mem,ptr,panic::PanicInfo};
type H = isize;
#[repr(C)]
struct GuiInfo { size:u32,flags:u32,active:H,focus:H,capture:H,menu:H,move_size:H,caret:H,rect:[i32;4] }
#[link(name="user32")]
unsafe extern "system" {
 fn IsWindow(w:H)->i32;
 fn GetWindowTextW(w:H,out:*mut u16,len:i32)->i32;
 fn GetWindowThreadProcessId(w:H,pid:*mut u32)->u32;
 fn GetForegroundWindow()->H;
 fn GetGUIThreadInfo(thread:u32,info:*mut GuiInfo)->i32;
 fn GetAncestor(w:H,flags:u32)->H;
 fn GetClassNameW(w:H,out:*mut u16,len:i32)->i32;
 fn EnumChildWindows(parent:H,callback:extern "system" fn(H,H)->i32,param:H)->i32;
}
#[link(name="kernel32")]
unsafe extern "system" {
 fn OpenProcess(access:u32,inherit:i32,pid:u32)->H;
 fn QueryFullProcessImageNameW(process:H,flags:u32,out:*mut u16,size:*mut u32)->i32;
 fn CloseHandle(h:H)->i32;
 fn GetLastError()->u32;
 fn SetLastError(code:u32);
 fn GetCommandLineW()->*const u16;
 fn GetStdHandle(which:u32)->H;
 fn WriteFile(h:H,data:*const u8,len:u32,written:*mut u32,overlapped:*mut u8)->i32;
 fn ExitProcess(code:u32)->!;
}
#[link(name="imm32",kind="raw-dylib")]
unsafe extern "system" {
 fn ImmGetContext(w:H)->H;
 fn ImmReleaseContext(w:H,context:H)->i32;
 fn ImmGetCompositionStringW(context:H,index:u32,out:*mut u8,len:u32)->i32;
 fn ImmGetOpenStatus(context:H)->i32;
 fn ImmNotifyIME(context:H,action:u32,index:u32,value:u32)->i32;
}
fn write(text:&str){unsafe{let mut n=0;WriteFile(GetStdHandle(-11i32 as u32),text.as_ptr(),text.len() as u32,&mut n,ptr::null_mut());}}
fn number(value:i64){let mut b=[0u8;24];let mut n=b.len();let neg=value<0;let mut v=value.unsigned_abs();loop{n-=1;b[n]=b'0'+(v%10) as u8;v/=10;if v==0{break;}}if neg{n-=1;b[n]=b'-';}write(core::str::from_utf8(&b[n..]).unwrap_or("0"));}
fn field(name:&str,value:i64){write(",\"");write(name);write("\":");number(value);}
fn fail(message:&str)->! {write("{\"error\":\"");write(message);write("\"}\n");unsafe{ExitProcess(2);}}
#[panic_handler]
fn panic(_: &PanicInfo)->!{unsafe{ExitProcess(9);}}
fn equals(text:&[u16],expected:&[u8])->bool{text.len()==expected.len()&&text.iter().zip(expected).all(|(a,b)|*a==u16::from(*b))}
extern "system" fn inspect_child(child:H,_:H)->i32{unsafe{
 let mut pid=0;let thread=GetWindowThreadProcessId(child,&mut pid);let context=ImmGetContext(child);let mut class=[0u16;128];let n=GetClassNameW(child,class.as_mut_ptr(),128);
 write("{\"child\":");number(child as i64);field("pid",pid as i64);field("thread",thread as i64);field("contextAvailable",(context!=0) as i64);write(",\"class\":\"");for c in &class[..n.max(0) as usize]{if *c>=32&&*c<127&&*c!=34&&*c!=92{let b=[*c as u8];write(core::str::from_utf8(&b).unwrap_or("?"));}}write("\"}\n");if context!=0{ImmReleaseContext(child,context);}1
}}
#[unsafe(no_mangle)]
pub extern "system" fn mainCRTStartup()->! {
 unsafe {
  let command=GetCommandLineW();let mut count=0;while count<4096&&*command.add(count)!=0{count+=1;}if count==4096{fail("long command");}
  let args=core::slice::from_raw_parts(command,count);let mut at=0;
  if args.first()==Some(&34){at=1;while at<count&&args[at]!=34{at+=1;}at+=1;}else{while at<count&&args[at]!=32{at+=1;}}
  while at<count&&args[at]==32{at+=1;}let start=at;while at<count&&args[at]!=32{at+=1;}
  let cancel=equals(&args[start..at],b"cancel");if !cancel&&!equals(&args[start..at],b"inspect"){fail("usage: inspect|cancel HWND");}
  while at<count&&args[at]==32{at+=1;}let mut root:H=0;let start=at;
  while at<count {let c=args[at];if !(48..=57).contains(&c){fail("invalid HWND");}root=root.checked_mul(10).and_then(|n|n.checked_add((c-48) as H)).unwrap_or_else(||fail("invalid HWND"));at+=1;}
  if at==start{fail("missing HWND");}
  if IsWindow(root)==0 {fail("window is gone");}
  let mut text=[0u16;512];let n=GetWindowTextW(root,text.as_mut_ptr(),512);
  if n<1||!equals(&text[..n as usize],b"Framilo") {fail("not the Framilo window");}
  if GetForegroundWindow()!=root {fail("Framilo must remain foreground");}
  let mut pid=0;let thread=GetWindowThreadProcessId(root,&mut pid);
  let process_handle=OpenProcess(0x1000,0,pid);if process_handle==0{fail("cannot identify owner");}
  let mut path=[0u16;1024];let mut size=path.len() as u32;
  let ok=QueryFullProcessImageNameW(process_handle,0,path.as_mut_ptr(),&mut size);CloseHandle(process_handle);
  let suffix=b"\\eagle.exe";
  if ok==0||size<suffix.len() as u32||!path[size as usize-suffix.len()..size as usize].iter().zip(suffix).all(|(a,b)|*a<128&&(*a as u8).to_ascii_lowercase()==*b){fail("owner is not Eagle.exe");}
  let mut gui:GuiInfo=mem::zeroed();gui.size=mem::size_of::<GuiInfo>() as u32;
  if GetGUIThreadInfo(thread,&mut gui)==0{fail("cannot inspect focused context");}
  let target=gui.focus;
  if target==0||GetAncestor(target,2)!=root {fail("focused control is outside Framilo");}
  let mut focus_pid=0;GetWindowThreadProcessId(target,&mut focus_pid);
  if focus_pid!=pid {fail("focused control owner differs");}
  let mut class=[0u16;128];let class_len=GetClassNameW(target,class.as_mut_ptr(),128);
  write("{\"mode\":\"");write(if cancel{"cancel"}else{"inspect"});write("\"");field("pid",pid as i64);field("thread",thread as i64);field("root",root as i64);field("focus",target as i64);write(",\"class\":\"");
  for c in &class[..class_len.max(0) as usize] {if *c>=32&&*c<127&&*c!=34&&*c!=92{let b=[*c as u8];write(core::str::from_utf8(&b).unwrap_or("?"));}}write("\"");
  let context=ImmGetContext(target);
  if context==0 {write(",\"contextAvailable\":false}\n");EnumChildWindows(root,inspect_child,0);ExitProcess(3);}
  let before=ImmGetCompositionStringW(context,8,ptr::null_mut(),0);
  let open=ImmGetOpenStatus(context)!=0;
  SetLastError(0);
  // NI_COMPOSITIONSTR=0x15, CPS_CANCEL=4. Never COMPLETE or change IME mode.
  let cancelled=if cancel {ImmNotifyIME(context,0x15,4,0)}else{-1};
  let error=GetLastError();let after=ImmGetCompositionStringW(context,8,ptr::null_mut(),0);
  ImmReleaseContext(target,context);
  write(",\"contextAvailable\":true");field("imeOpen",open as i64);field("beforeBytes",before as i64);field("notifyResult",cancelled as i64);field("lastError",error as i64);field("afterBytes",after as i64);write("}\n");ExitProcess(0);
 }
}
