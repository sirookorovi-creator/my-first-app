import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

function launchBrowserStub() {
  const nodes=new Map(),spoken=[];
  const makeElement=(tag='div')=>({
    tag,children:[],handlers:{},dataset:{},style:{},textContent:'',value:'',
    firstElementChild:{textContent:''},
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(event,fn){this.handlers[event]=fn},
    append(...elements){this.children.push(...elements)},
    appendChild(element){this.children.push(element)},
    replaceChildren(...elements){this.children=[...elements]}
  });
  const document={
    getElementById(id){if(!nodes.has(id))nodes.set(id,makeElement(id));return nodes.get(id)},
    createElement:makeElement,
    querySelectorAll(){return []}
  };
  const speechSynthesis={
    cancel(){},getVoices(){return []},speak(utterance){spoken.push(utterance)}
  };
  const context={
    document,location:{hash:'',origin:'https://voxbridge.example'},
    window:{addEventListener(){},speechSynthesis},
    navigator:{},speechSynthesis,
    SpeechSynthesisUtterance:class{constructor(text){this.text=text}},
    setInterval(){return 1}
  };
  vm.runInNewContext(app+'\n'+'globalThis.__render=(room,msg)=>{currentRoom=room;insertMessage(msg)};',context);
  const render=(role,message)=>{
    const room={role,ownerLanguage:'uk',guestLanguage:'en'};
    nodes.get('chatMessages').children=[];
    context.__render(room,message);
    const box=nodes.get('chatMessages').children[0];
    const get=className=>box.children.find(el=>el.className===className);
    const details=get('original');
    const bottom=get('message-bottom');
    const listen=bottom.children[1];
    listen.handlers.click();
    return {
      label:get('message-meta').textContent,
      text:get('message-main').textContent,
      detailLabel:details.children[0].textContent,
      detailText:details.children[1].textContent,
      spoken:spoken.at(-1)
    };
  };
  return {render};
}

test('both users read and hear their own language, for both speakers',()=>{
  const {render}=launchBrowserStub();
  const ownerMessage={speaker:'owner',original:'Привіт',translated:'Hello',createdAt:123456};
  const guestMessage={speaker:'guest',original:'How are you?',translated:'Як справи?',createdAt:123457};

  const ownerOwn=render('owner',ownerMessage);
  assert.equal(ownerOwn.text,'Привіт');
  assert.equal(ownerOwn.spoken.text,'Привіт');
  assert.equal(ownerOwn.spoken.lang,'uk-UA');
  assert.equal(ownerOwn.detailLabel,'Translation');
  assert.equal(ownerOwn.detailText,'Hello');

  const guestIncoming=render('guest',ownerMessage);
  assert.equal(guestIncoming.text,'Hello');
  assert.equal(guestIncoming.spoken.text,'Hello');
  assert.equal(guestIncoming.spoken.lang,'en-US');
  assert.equal(guestIncoming.detailLabel,'Original text');
  assert.equal(guestIncoming.detailText,'Привіт');

  const guestOwn=render('guest',guestMessage);
  assert.equal(guestOwn.text,'How are you?');
  assert.equal(guestOwn.spoken.text,'How are you?');
  assert.equal(guestOwn.spoken.lang,'en-US');
  assert.equal(guestOwn.detailLabel,'Translation');
  assert.equal(guestOwn.detailText,'Як справи?');

  const ownerIncoming=render('owner',guestMessage);
  assert.equal(ownerIncoming.text,'Як справи?');
  assert.equal(ownerIncoming.spoken.text,'Як справи?');
  assert.equal(ownerIncoming.spoken.lang,'uk-UA');
  assert.equal(ownerIncoming.detailLabel,'Original text');
  assert.equal(ownerIncoming.detailText,'How are you?');
});
