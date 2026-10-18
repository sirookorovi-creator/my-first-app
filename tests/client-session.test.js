import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const message=id=>({id,speaker:'owner',original:id,translated:`translated ${id}`,createdAt:123456});
const room=(...ids)=>({role:'owner',ownerLanguage:'uk',guestLanguage:'en',guestToken:'invitation',expiresAt:2000000000,messages:ids.map(message)});

function browser({microphone}={}) {
  const nodes=new Map(),requests=[],recorders=[];
  const makeElement=(tag='div')=>{
    const classes=new Set();
    return {
      tag,children:[],handlers:{},dataset:{},style:{},textContent:'',value:'',checked:false,disabled:false,
      firstElementChild:{textContent:''},
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name)}},
      addEventListener(event,fn){this.handlers[event]=fn},
      append(...elements){this.children.push(...elements)},
      appendChild(element){this.children.push(element)},
      replaceChildren(...elements){this.children=[...elements]}
    };
  };
  const document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,makeElement(id));return nodes.get(id)},createElement:makeElement,querySelectorAll:()=>[]};
  document.getElementById('consent');
  class MediaRecorder {
    static isTypeSupported(){return true}
    constructor(stream,options){this.stream=stream;this.mimeType=options?.mimeType||'audio/webm';this.state='inactive';recorders.push(this)}
    start(){this.state='recording'}
    stop(){
      this.state='inactive';
      const data=this.ondataavailable,stop=this.onstop;
      this.completion=Promise.resolve().then(async()=>{data?.({data:new Blob([new Uint8Array(1024)])});await stop?.()});
    }
  }
  const location={hash:'',origin:'https://voxbridge.example'};
  const speechSynthesis={cancel(){},getVoices:()=>[]};
  const context={
    document,location,history:{replaceState(_state,_title,url){location.hash=url.includes('#')?url.slice(url.indexOf('#')):''}},
    window:{addEventListener(){},speechSynthesis,MediaRecorder},
    navigator:{mediaDevices:{getUserMedia:microphone||(()=>{throw Error('No test microphone')})}},
    MediaRecorder,speechSynthesis,FormData,Blob,confirm:()=>true,
    setInterval:()=>1,setTimeout:()=>2,clearInterval(){},clearTimeout(){},
    fetch(path,options){const pending=deferred();requests.push({path,options,reply:(body,status=200)=>pending.resolve(Response.json(body,{status}))});return pending.promise}
  };
  vm.runInNewContext(app+`
    globalThis.client={loadRoom,displayHome,sendMessage,refreshIfVisible,startRecording,stopRecording,deleteChat,create,
      state:()=>({token:currentToken,room:currentRoom,invitation:guestShareToken,sending})};`,context);
  async function open(token,data=room()) {
    const loading=context.client.loadRoom(token);
    const request=requests.shift();
    assert.equal(request.path,`/api/session/${token}`);
    request.reply(data);
    await loading;
  }
  return {client:context.client,nodes,requests,recorders,open};
}

test('the latest navigation wins when room responses arrive out of order',async()=>{
  const {client,requests}=browser();
  const first=client.loadRoom('a'),requestA=requests.shift();
  const second=client.loadRoom('b'),requestB=requests.shift();
  requestB.reply(room('B'));await second;
  requestA.reply(room('A'));await first;
  assert.equal(client.state().token,'b');
  assert.equal(client.state().room.messages[0].id,'B');
});

test('a late failed navigation cannot hide a successfully opened room',async()=>{
  const {client,requests,open}=browser();
  const loading=client.loadRoom('old'),request=requests.shift();
  await open('current',room('Current'));
  request.reply({error:'Conversation not found'},404);await loading;
  assert.equal(client.state().token,'current');
  assert.equal(client.state().room.messages[0].id,'Current');
});

test('a late send cannot add messages, clear drafts, or unlock another conversation',async()=>{
  const {client,nodes,requests,open}=browser();
  await open('a');nodes.get('consent').checked=true;
  const sendingA=client.sendMessage({text:'A'}),requestA=requests.shift();
  await open('b');nodes.get('consent').checked=true;
  nodes.get('textInput').value='B draft';
  const sendingB=client.sendMessage({text:'B'}),requestB=requests.shift();
  assert.ok(requestB,'a new conversation must not stay locked by an old send');
  requestA.reply({message:message('A')});await sendingA;
  assert.equal(client.state().room.messages.length,0);
  assert.equal(nodes.get('textInput').value,'B draft');
  assert.equal(client.state().sending,true);
  requestB.reply({message:message('B')});await sendingB;
  assert.equal(client.state().room.messages.map(m=>m.id).join(','),'B');
  assert.equal(client.state().sending,false);
});

test('stale polls are ignored and a deleted room clears private UI and invitation',async()=>{
  const {client,nodes,requests,open}=browser();
  await open('a',room('A'));
  const pollingA=client.refreshIfVisible(),requestA=requests.shift();
  await open('b',room('B','B2'));nodes.get('consent').checked=true;
  requestA.reply(room('A','A2','A3'));await pollingA;
  assert.equal(client.state().room.messages.map(m=>m.id).join(','),'B,B2');
  const pollingB=client.refreshIfVisible();requests.shift().reply({error:'Conversation not found'},404);await pollingB;
  assert.equal(client.state().token,null);
  assert.equal(client.state().room,null);
  assert.equal(client.state().invitation,null);
  assert.equal(nodes.get('chatMessages').children.length,0);
  assert.equal(nodes.get('consent').checked,false);
  assert.equal(nodes.get('conversation').classList.contains('hidden'),true);
});

test('temporary polling errors preserve the current conversation and unsent draft',async()=>{
  const {client,nodes,requests,open}=browser();
  await open('a',room('A'));nodes.get('textInput').value='Unsent';
  const polling=client.refreshIfVisible();requests.shift().reply({error:'Temporarily unavailable'},503);await polling;
  assert.equal(client.state().token,'a');
  assert.equal(client.state().room.messages[0].id,'A');
  assert.equal(nodes.get('textInput').value,'Unsent');
});

test('a poll captured before a send cannot remove the newly sent message',async()=>{
  const {client,nodes,requests,open}=browser();
  await open('a');
  const polling=client.refreshIfVisible(),request=requests.shift();
  nodes.get('consent').checked=true;
  const sending=client.sendMessage({text:'Mine'});requests.shift().reply({message:message('Mine')});await sending;
  request.reply(room('Earlier','Earlier2'));await polling;
  assert.equal(client.state().room.messages[0].id,'Mine');
  const nextPoll=client.refreshIfVisible();requests.shift().reply(room('Earlier','Earlier2','Mine'));await nextPoll;
  assert.equal(client.state().room.messages.map(m=>m.id).join(','),'Earlier,Earlier2,Mine');
});

test('leaving a conversation stops and discards its recording',async()=>{
  let stops=0;
  const stream={getTracks:()=>[{stop(){stops++}}]};
  const {client,nodes,requests,recorders,open}=browser({microphone:async()=>stream});
  await open('a');nodes.get('consent').checked=true;
  await client.startRecording();assert.equal(recorders[0].state,'recording');
  client.displayHome();
  assert.equal(recorders[0].state,'inactive');
  assert.ok(stops>0,'the microphone track must stop immediately');
  await open('b');nodes.get('consent').checked=true;
  await recorders[0].completion;
  assert.equal(requests.length,0,'discarded audio must never be sent to another room');
});

test('microphone permission granted after navigation cannot start an old recording',async()=>{
  const permission=deferred();let stops=0;
  const {client,nodes,recorders,open}=browser({microphone:()=>permission.promise});
  await open('a');nodes.get('consent').checked=true;
  const starting=client.startRecording();
  client.displayHome();await open('b');nodes.get('consent').checked=true;
  permission.resolve({getTracks:()=>[{stop(){stops++}}]});await starting;
  assert.equal(recorders.length,0);
  assert.equal(stops,1);
});

test('consent is required before requesting microphone access',async()=>{
  let permissions=0;
  const {client,recorders,open}=browser({microphone:async()=>{permissions++;throw Error('Should not be requested')}});
  await open('a');await client.startRecording();
  assert.equal(permissions,0);assert.equal(recorders.length,0);
});

test('a normal recording is sent once to its original room with explicit consent',async()=>{
  let stops=0;
  const {client,nodes,requests,recorders,open}=browser({microphone:async()=>({getTracks:()=>[{stop(){stops++}}]})});
  await open('a');nodes.get('consent').checked=true;
  await client.startRecording();
  assert.equal(nodes.get('sendText').disabled,true);
  assert.equal(nodes.get('recordButton').disabled,false,'the stop button stays available');
  client.stopRecording();await Promise.resolve();
  const request=requests.shift();
  assert.equal(request.path,'/api/session/a/messages');
  assert.ok(request.options.body instanceof FormData);
  assert.equal(request.options.body.get('consent'),'yes');
  assert.equal(request.options.body.get('audio').size,1024);
  request.reply({message:message('Voice')});await recorders[0].completion;
  assert.equal(requests.length,0);assert.equal(stops,1);
  assert.equal(client.state().room.messages[0].id,'Voice');
  assert.equal(nodes.get('sendText').disabled,false);
});

test('an already queued recording callback cannot send audio after navigation',async()=>{
  const {client,nodes,requests,recorders,open}=browser({microphone:async()=>({getTracks:()=>[{stop(){}}]})});
  await open('a');nodes.get('consent').checked=true;await client.startRecording();
  client.stopRecording();client.displayHome();
  await open('b');nodes.get('consent').checked=true;
  await recorders[0].completion;
  assert.equal(client.state().token,'b');assert.equal(requests.length,0);
});

test('deleting an old conversation cannot navigate away from a newly opened one',async()=>{
  const {client,requests,open}=browser();
  await open('a');const deleting=client.deleteChat(),request=requests.shift();
  await open('b',room('B'));request.reply({ok:true});await deleting;
  assert.equal(client.state().token,'b');
  assert.equal(client.state().room.messages[0].id,'B');
});

test('a late room creation cannot replace a conversation opened in the meantime',async()=>{
  const {client,requests,open}=browser();
  const creating=client.create(),request=requests.shift();
  assert.equal(request.path,'/api/rooms');
  await open('existing',room('Existing'));
  request.reply({ownerToken:'created',guestToken:'invitation'});await creating;
  assert.equal(client.state().token,'existing');assert.equal(requests.length,0);
});
