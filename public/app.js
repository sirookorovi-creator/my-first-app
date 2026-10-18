const LANGS = {en:'English',uk:'Ukrainian',es:'Spanish',fr:'French',de:'German',pl:'Polish',pt:'Portuguese',it:'Italian',tr:'Turkish',ar:'Arabic',hi:'Hindi',ru:'Russian',ja:'Japanese'};
const BCP47 = {en:'en-US',uk:'uk-UA',es:'es-ES',fr:'fr-FR',de:'de-DE',pl:'pl-PL',pt:'pt-PT',it:'it-IT',tr:'tr-TR',ar:'ar-SA',hi:'hi-IN',ru:'ru-RU',ja:'ja-JP'};
const $ = id => document.getElementById(id);
const els = {home:$('home'),brand:$('brand'),conversation:$('conversation'),uiToggle:$('uiToggle'),ownerLanguage:$('ownerLanguage'),guestLanguage:$('guestLanguage'),swapLang:$('swapLang'),createButton:$('createButton'),roomTitle:$('roomTitle'),roomHint:$('roomHint'),newChat:$('newChat'),chatLanguages:$('chatLanguages'),chatMessages:$('chatMessages'),recordButton:$('recordButton'),recStatus:$('recStatus'),recSeconds:$('recSeconds'),recordLabel:$('recordLabel'),recordHelp:$('recordHelp'),textInput:$('textInput'),sendText:$('sendText'),busyBar:$('busyBar'),copyLink:$('copyLink'),nativeShare:$('nativeShare'),shareTitle:$('shareTitle'),shareHelp:$('shareHelp'),expiry:$('expiry'),myLang:$('myLang'),otherLang:$('otherLang'),deleteChat:$('deleteChat'),toast:$('toast')};
let currentToken = null, currentRoom = null, currentLang = 'en';
let stream = null, recorder = null, recordingTimer = null, timerClock = null, sending = false;
let sessionRevision=0, microphoneRequestId=0, microphoneRequestPending=false, guestShareToken=null;
let toastTimer;
const UI = {
  en:{roomTitle:'Your conversation',roomHint:'Share the link to start talking.',recordLabel:'Tap to record',recording:'Recording — tap to stop',busy:'Processing your message...',recordHelp:'Up to 25 seconds · microphone required',shareTitle:'Bring someone in.',shareHelp:'Send this link. They can listen to the translated message and respond without creating an account.',copy:'Copy invitation link',send:'Send ↑',placeholder:'Or type a message...',copied:'Link copied. Send it to the other person.',created:'Conversation created. Record a message, then share your link.',failed:'Something went wrong.',speechFailed:'This device does not support speech playback.',confirmDelete:'Delete this entire conversation and all its messages?',mine:'You',theirs:'Other person',original:'Original text',translation:'Translation',speak:'▶ Listen',emptyTitle:'Ready to cross the language barrier?',emptyHelp:'Record a message or type below. It will appear here translated for the other person.',noMic:'Microphone permission denied or unavailable. You can type a message instead.'},
  uk:{roomTitle:'Ваша розмова',roomHint:'Надішліть посилання, щоб почати спілкування.',recordLabel:'Записати голос',recording:'Запис триває — натисніть для завершення',busy:'Обробляємо повідомлення...',recordHelp:'До 25 секунд · потрібен мікрофон',shareTitle:'Запросити співрозмовника',shareHelp:'Надішліть посилання. Людина зможе почути переклад і відповісти без реєстрації.',copy:'Копіювати запрошення',send:'Надіслати ↑',placeholder:'Або напишіть повідомлення...',copied:'Посилання скопійовано. Надішліть співрозмовнику.',created:'Розмову створено. Запишіть повідомлення та надішліть посилання.',failed:'Сталася помилка.',speechFailed:'Цей пристрій не підтримує озвучення.',confirmDelete:'Видалити всю розмову і повідомлення?',mine:'Ви',theirs:'Співрозмовник',original:'Оригінал',translation:'Переклад',speak:'▶ Слухати',emptyTitle:'Готові спілкуватися іншою мовою?',emptyHelp:'Запишіть голосове або напишіть текст. Ми покажемо його співрозмовнику з перекладом.',noMic:'Мікрофон недоступний. Можна надіслати текст.'}
};
Object.assign(UI.en,{"topTag": "VOICE × TRANSLATION", "heroLabel": "AI VOICE MESSAGING", "heroSub": "Send a voice message in your language. They hear the translation and reply in their own. One private link. No app to install.", "step1": "Record a message", "step2": "Send a private link", "step3": "Get a translated reply", "finePrint": "Beta · Voice-to-text translation · Device-generated speech · Messages expire after 7 days", "newLabel": "NEW CONVERSATION", "createTitle": "Bridge two languages.", "createCopy": "Choose your language and theirs. You'll get a link to send to the other person.", "iSpeak": "I speak", "theySpeak": "They speak", "createButton": "Create conversation", "cardDisclaimer": "A private link is the key to this conversation. Only share it with people you trust.", "newChat": "+ New conversation", "nativeShare": "Share with another app", "deleteChat": "Delete conversation and messages", "consentText": "I agree to send my voice/text to an external AI provider for transcription and translation.", "composeNote": "AI translation may contain errors. Check important details independently.", "privacyLink": "Privacy & data", "consentRequired": "Please agree to AI processing before sending."});
Object.assign(UI.uk,{"topTag": "ГОЛОС × ПЕРЕКЛАД", "heroLabel": "AI ГОЛОСОВІ ПОВІДОМЛЕННЯ", "heroSub": "Запишіть голосове своєю мовою. Співрозмовник почує переклад та відповість своєю. Одне приватне посилання. Без встановлення застосунку.", "step1": "Запишіть повідомлення", "step2": "Надішліть приватне посилання", "step3": "Отримайте перекладену відповідь", "finePrint": "Бета · Переклад мовлення в текст · Озвучення телефоном · Видалення через 7 днів", "newLabel": "НОВА РОЗМОВА", "createTitle": "З’єднайте дві мови.", "createCopy": "Оберіть свою мову та мову співрозмовника. Ми створимо посилання для запрошення.", "iSpeak": "Я розмовляю", "theySpeak": "Співрозмовник розмовляє", "createButton": "Створити розмову", "cardDisclaimer": "Приватне посилання відкриває доступ до розмови. Діліться лише з людьми, яким довіряєте.", "newChat": "+ Нова розмова", "nativeShare": "Поділитися через інший застосунок", "deleteChat": "Видалити розмову та повідомлення", "consentText": "Погоджуюся на передавання голосу/тексту зовнішньому AI-провайдеру для розпізнавання та перекладу.", "composeNote": "AI може помилятися. Самостійно перевіряйте важливі подробиці.", "privacyLink": "Приватність", "consentRequired": "Підтвердіть згоду на AI-обробку перед надсиланням."});
UI.en.sessionExpired='This conversation was deleted or has expired. Create a new one.';
UI.uk.sessionExpired='Розмову видалено або термін її дії минув. Створіть нову.';
const t = name => UI[currentLang][name] || UI.en[name] || name;
const setText = (id, value) => {els[id].textContent = value};
function pop(text, error=false){els.toast.textContent=text;els.toast.style.borderColor=error?'#a64b63':'#39696b';els.toast.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.classList.add('hidden'),4800)}
function tokenFromURL() {const m=location.hash.match(/^#c=([0-9a-f]{64})$/);return m?m[1]:null}
const sessionURL = token => `${location.origin}/#c=${token}`;
async function api(path, options={}){
  let response;
  try { response = await fetch(path,{...options, cache:'no-store',headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})}}) }
  catch {throw Error('Network unavailable. Check your connection.')}
  let result;try{result=await response.json()}catch{throw Object.assign(Error(`Server response ${response.status}`),{status:response.status})}
  if(!response.ok)throw Object.assign(Error(result.error || `Error ${response.status}`),{status:response.status});
  return result;
}
function populateLanguages(){for(const [code,label] of Object.entries(LANGS)){for(const select of [els.ownerLanguage,els.guestLanguage]){const opt=document.createElement('option');opt.value=code;opt.textContent=label;select.appendChild(opt)}}els.ownerLanguage.value='uk';els.guestLanguage.value='en'}
function updateUI(){for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);$('heroHeading').innerHTML=currentLang==='uk'?'Говоріть своєю.<br><em>Слухайте іншою.</em>':'Speak in yours.<br><em>Hear in theirs.</em>';const isUA=currentLang==='uk';els.uiToggle.textContent=isUA?'EN':'UA';els.uiToggle.title=isUA?'English interface':'Український інтерфейс';els.roomTitle.textContent=t('roomTitle');els.roomHint.textContent=t('roomHint');els.recordLabel.textContent=t(recorder?'recording':'recordLabel');els.recordHelp.textContent=t('recordHelp');els.textInput.placeholder=t('placeholder');els.sendText.textContent=t('send');els.copyLink.firstElementChild.textContent=t('copy');els.shareTitle.textContent=t('shareTitle');els.shareHelp.textContent=t('shareHelp');if(currentRoom)renderMessages()}
const isCurrentSession=(token,revision)=>currentToken===token&&sessionRevision===revision;
function resetSession(){
  sessionRevision++;
  cancelRecording();
  currentToken=null;currentRoom=null;guestShareToken=null;
  els.chatMessages.replaceChildren();els.textInput.value='';$('consent').checked=false;
  window.speechSynthesis?.cancel();
  setBusy(false);els.createButton.disabled=false;
  els.conversation.classList.add('hidden');els.home.classList.remove('hidden');
  return sessionRevision;
}
function displayHome(){resetSession();history.replaceState(null,'','/')}
async function loadRoom(token){
  const revision=resetSession();
  let result;
  try{result=await api(`/api/session/${token}`)}
  catch(err){if(revision!==sessionRevision)return false;displayHome();throw err}
  if(revision!==sessionRevision)return false;
  currentToken=token;currentRoom=result;guestShareToken=result.role==='owner'?result.guestToken:null;
  els.home.classList.add('hidden');els.conversation.classList.remove('hidden');
  els.chatLanguages.textContent=`${LANGS[result.ownerLanguage]} ⇄ ${LANGS[result.guestLanguage]}`;
  els.expiry.textContent=new Date(result.expiresAt*1000).toLocaleDateString();
  els.myLang.textContent=LANGS[result.role==='owner'?result.ownerLanguage:result.guestLanguage];
  els.otherLang.textContent=LANGS[result.role==='owner'?result.guestLanguage:result.ownerLanguage];
  els.deleteChat.classList.toggle('hidden',result.role!=='owner');els.copyLink.classList.toggle('hidden',result.role!=='owner');
  els.nativeShare.classList.toggle('hidden',result.role!=='owner'||!navigator.share);
  els.shareTitle.textContent=result.role==='owner'?t('shareTitle'):'You can reply here';
  els.shareHelp.textContent=result.role==='owner'?t('shareHelp'):'This is a private conversation. Reply in your own language. You can make a new conversation from the top.';
  renderMessages();return true;
}
function insertMessage(msg){const own=msg.speaker===currentRoom.role;const lang=currentRoom.role==='owner'?currentRoom.ownerLanguage:currentRoom.guestLanguage;const visibleText=own?msg.original:msg.translated;const box=document.createElement('article');box.className=`message ${own?'own':'other'}`;const meta=document.createElement('div');meta.className='message-meta';meta.textContent=`${own?t('mine'):t('theirs')} · ${LANGS[lang]}`;const main=document.createElement('div');main.className='message-main';main.textContent=visibleText;const bottom=document.createElement('div');bottom.className='message-bottom';const time=document.createElement('span');time.className='message-small';time.textContent=new Date(msg.createdAt*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const listen=document.createElement('button');listen.className='speak-btn';listen.textContent=t('speak');listen.addEventListener('click',()=>speak(visibleText,lang));bottom.append(time,listen);const details=document.createElement('details');details.className='original';const summary=document.createElement('summary');summary.textContent=own?t('translation'):t('original');const orig=document.createElement('p');orig.textContent=own?msg.translated:msg.original;details.append(summary,orig);box.append(meta,main,bottom,details);els.chatMessages.append(box)}
function renderMessages(){if(!currentRoom)return;els.chatMessages.replaceChildren();if(currentRoom.messages.length===0){const empty=document.createElement('div');empty.className='empty-chat';const symbol=document.createElement('div');symbol.className='empty-icon';symbol.textContent='◎';const h=document.createElement('h3');h.textContent=t('emptyTitle');const p=document.createElement('p');p.textContent=t('emptyHelp');empty.append(symbol,h,p);els.chatMessages.append(empty)}else for(const msg of currentRoom.messages)insertMessage(msg);els.chatMessages.scrollTop=els.chatMessages.scrollHeight}
function speak(text,language){if(!('speechSynthesis' in window)){pop(t('speechFailed'),true);return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang=BCP47[language];utterance.rate=.95;const voices=speechSynthesis.getVoices();const voice=voices.find(v=>v.lang.toLowerCase()===utterance.lang.toLowerCase())||voices.find(v=>v.lang.toLowerCase().startsWith(language));if(voice)utterance.voice=voice;speechSynthesis.speak(utterance)}
function syncComposer(){const capturing=!!recorder||microphoneRequestPending;els.recordButton.disabled=sending||microphoneRequestPending;els.sendText.disabled=sending||capturing;els.textInput.disabled=sending||capturing}
function setBusy(value){sending=value;syncComposer();els.busyBar.textContent=t('busy');els.busyBar.classList.toggle('hidden',!value)}
async function sendMessage(payload,revision=sessionRevision){
  const token=currentToken;
  if(!token||!currentRoom||revision!==sessionRevision||sending||recorder||microphoneRequestPending)return;
  if(!$('consent').checked){pop(t('consentRequired'),true);return}
  if(payload instanceof FormData)payload.append('consent','yes');else payload.consent=true;
  setBusy(true);
  try{
    const res=await api(`/api/session/${token}/messages`,{method:'POST',body:payload instanceof FormData?payload:JSON.stringify(payload)});
    if(!isCurrentSession(token,revision))return;
    if(!currentRoom.messages.some(msg=>msg.id===res.message.id))currentRoom.messages.push(res.message);
    renderMessages();els.textInput.value='';
  }catch(err){
    if(!isCurrentSession(token,revision))return;
    if(err.status===404){displayHome();pop(t('sessionExpired'),true)}else pop(err.message,true);
  }finally{if(isCurrentSession(token,revision))setBusy(false)}
}
function resetRecordingUI(){clearInterval(timerClock);clearTimeout(recordingTimer);timerClock=null;recordingTimer=null;els.recStatus.classList.add('hidden');els.recordButton.classList.remove('is-recording');els.recordLabel.textContent=t('recordLabel')}
function stopTracks(activeStream){activeStream?.getTracks().forEach(track=>track.stop())}
function cancelRecording(){
  microphoneRequestId++;microphoneRequestPending=false;
  const activeRecorder=recorder;recorder=null;
  if(activeRecorder){activeRecorder.ondataavailable=null;activeRecorder.onstop=null;activeRecorder.onerror=null;if(activeRecorder.state!=='inactive'){try{activeRecorder.stop()}catch{}}}
  stopTracks(stream);stream=null;resetRecordingUI();syncComposer();
}
async function startRecording(){
  if(!currentToken||!currentRoom||sending||recorder||microphoneRequestPending)return;
  if(!$('consent').checked){pop(t('consentRequired'),true);return}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){pop(t('noMic'),true);return}
  const token=currentToken,revision=sessionRevision,requestId=++microphoneRequestId;
  microphoneRequestPending=true;syncComposer();
  let activeStream;
  try{
    activeStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    if(!isCurrentSession(token,revision)||requestId!==microphoneRequestId||sending||!$('consent').checked){stopTracks(activeStream);return}
    const type=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));
    const activeRecorder=new MediaRecorder(activeStream,type?{mimeType:type}:undefined),parts=[];
    stream=activeStream;recorder=activeRecorder;
    activeRecorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
    activeRecorder.onstop=async()=>{
      stopTracks(activeStream);
      if(!isCurrentSession(token,revision)||recorder!==activeRecorder)return;
      recorder=null;stream=null;resetRecordingUI();syncComposer();
      const mime=activeRecorder.mimeType.split(';')[0]||'audio/webm',blob=new Blob(parts,{type:mime});
      if(blob.size<500){pop('Recording is too short.',true);return}
      if(blob.size>3_000_000){pop('Recording is too large.',true);return}
      const data=new FormData(),ext=mime==='audio/mp4'?'mp4':mime==='audio/ogg'?'ogg':'webm';
      data.append('audio',blob,`voice.${ext}`);await sendMessage(data,revision);
    };
    activeRecorder.onerror=()=>{stopTracks(activeStream);if(isCurrentSession(token,revision)&&recorder===activeRecorder){cancelRecording();pop(t('noMic'),true)}};
    activeRecorder.start();const recordStarted=Date.now();
    els.recStatus.classList.remove('hidden');els.recordButton.classList.add('is-recording');els.recordLabel.textContent=t('recording');els.recSeconds.textContent='0:00';
    timerClock=setInterval(()=>{if(!isCurrentSession(token,revision)||recorder!==activeRecorder)return;const secs=Math.floor((Date.now()-recordStarted)/1000);els.recSeconds.textContent=`0:${String(secs).padStart(2,'0')}`},500);
    recordingTimer=setTimeout(()=>{if(isCurrentSession(token,revision)&&recorder===activeRecorder)stopRecording()},25000);
  }catch{
    stopTracks(activeStream);
    if(isCurrentSession(token,revision)&&requestId===microphoneRequestId){cancelRecording();pop(t('noMic'),true)}
  }finally{if(requestId===microphoneRequestId){microphoneRequestPending=false;syncComposer()}}
}
function stopRecording(){if(recorder?.state==='recording')recorder.stop()}
function shareURL(){return sessionURL(currentRoom?.guestToken||'')}
async function create(){
  const ownerLanguage=els.ownerLanguage.value,guestLanguage=els.guestLanguage.value;
  if(ownerLanguage===guestLanguage){pop('Choose different languages.',true);return}
  const revision=resetSession();els.createButton.disabled=true;
  let result;
  try{result=await api('/api/rooms',{method:'POST',body:JSON.stringify({ownerLanguage,guestLanguage})})}
  catch(err){if(revision===sessionRevision)pop(err.message,true);return}
  finally{if(revision===sessionRevision)els.createButton.disabled=false}
  if(revision!==sessionRevision)return;
  history.replaceState(null,'',`/#c=${result.ownerToken}`);
  try{if(await loadRoom(result.ownerToken))pop(t('created'))}catch(err){pop(err.message,true)}
}
// The share token is encrypted in D1 and returned only to the creator.
async function copyLink(){if(!guestShareToken){pop('Invitation is available only to the conversation creator.',true);return}const link=sessionURL(guestShareToken);try{await navigator.clipboard.writeText(link);pop(t('copied'))}catch{window.prompt('Copy invitation link:',link)}}
async function nativeShare(){if(!guestShareToken)return;try{await navigator.share({title:'VOXBRIDGE',text:'Let’s chat in our own languages',url:sessionURL(guestShareToken)})}catch{}}
async function deleteChat(){
  if(!currentToken||!confirm(t('confirmDelete')))return;
  const token=currentToken,revision=sessionRevision;
  try{await api(`/api/session/${token}`,{method:'DELETE'});if(isCurrentSession(token,revision)){displayHome();pop('Conversation deleted.')}}
  catch(err){if(isCurrentSession(token,revision)){if(err.status===404){displayHome();pop(t('sessionExpired'),true)}else pop(err.message,true)}}
}
async function refreshIfVisible(){
  if(!currentToken||document.hidden||sending||recorder||microphoneRequestPending)return;
  const token=currentToken,revision=sessionRevision;
  try{
    const result=await api(`/api/session/${token}`);
    if(!isCurrentSession(token,revision)||sending||recorder||microphoneRequestPending)return;
    if(result.messages.length>currentRoom.messages.length&&currentRoom.messages.every(msg=>result.messages.some(incoming=>incoming.id===msg.id))){currentRoom=result;renderMessages()}
  }catch(err){if(isCurrentSession(token,revision)&&err.status===404){displayHome();pop(t('sessionExpired'),true)}}
}
function start(){populateLanguages();els.createButton.addEventListener('click',create);els.swapLang.addEventListener('click',()=>{const a=els.ownerLanguage.value;els.ownerLanguage.value=els.guestLanguage.value;els.guestLanguage.value=a});els.newChat.addEventListener('click',displayHome);els.brand.addEventListener('click',e=>{e.preventDefault();displayHome()});els.uiToggle.addEventListener('click',()=>{currentLang=currentLang==='en'?'uk':'en';updateUI()});els.copyLink.addEventListener('click',copyLink);els.nativeShare.addEventListener('click',nativeShare);els.deleteChat.addEventListener('click',deleteChat);els.recordButton.addEventListener('click',()=>recorder?.state==='recording'?stopRecording():startRecording());els.sendText.addEventListener('click',()=>{const text=els.textInput.value.trim();if(text)sendMessage({text})});els.textInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();const text=els.textInput.value.trim();if(text)sendMessage({text})}});window.addEventListener('hashchange',()=>{const token=tokenFromURL();if(token)loadRoom(token).catch(err=>pop(err.message,true));else displayHome()});const token=tokenFromURL();if(token)loadRoom(token).catch(err=>pop(err.message,true));updateUI();setInterval(refreshIfVisible,30000)}
start();
