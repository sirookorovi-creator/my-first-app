"""Optional DOM smoke test (mock API): python tests/browser_smoke.py."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / 'public'
MOCK_JS = r'''
window.__msgs = [];
window.history.replaceState = (s,title,path) => {
  const hash = path.includes('#') ? path.slice(path.indexOf('#')) : '';
  if(location.hash !== hash) location.hash=hash;
};
window.fetch = async (path,options={}) => {
  let data = {}, status = 200;
  const token = (String(path).match(/[0-9a-f]{64}/)||[])[0];
  const owner = 'a'.repeat(64), guest = 'b'.repeat(64);
  const role = token === guest ? 'guest':'owner';
  if(path==='/api/rooms') { data={ownerToken:owner,guestToken:guest,expiresAt:2000000000};status=201; }
  else if(String(path).endsWith('/messages')){
    const req=JSON.parse(options.body);
    const msg={id:String(window.__msgs.length+1),speaker:role,original:req.text,translated:'Translated: '+req.text,createdAt:1790000000};
    window.__msgs.push(msg);data={message:msg};status=201;
  }else{
    data={role,ownerLanguage:'uk',guestLanguage:'en',expiresAt:2000000000,messages:window.__msgs};
    if(role==='owner') data.guestToken=guest;
  }
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking'],timeout=10000)
    page=browser.new_page(viewport={'width':1365,'height':850})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    page.add_script_tag(content=MOCK_JS)
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    assert page.locator('#ownerLanguage option').count()==13
    page.locator('#uiToggle').click()
    assert page.locator('#createTitle').inner_text()=='З’єднайте дві мови.'
    page.locator('#uiToggle').click()
    page.locator('#createButton').click()
    page.wait_for_selector('#conversation:not(.hidden)',timeout=5000)
    assert 'Ukrainian ⇄ English' in page.locator('#chatLanguages').inner_text()
    page.locator('#consent').check()
    page.locator('#textInput').fill('Привіт!')
    page.locator('#sendText').click()
    page.wait_for_selector('.message')
    assert 'Translated: Привіт!' in page.locator('.message-main').inner_text()
    assert page.locator('#copyLink').is_visible()
    page.screenshot(path='/mnt/data/voxbridge-chat-preview.png',full_page=True)
    page.evaluate("window.location.hash='#c='+ 'b'.repeat(64)")
    page.wait_for_function("document.querySelector('#copyLink').classList.contains('hidden')")
    page.locator('#consent').check()
    page.locator('#textInput').fill('Hello!')
    page.locator('#sendText').click()
    page.wait_for_function('document.querySelectorAll(".message").length === 2')
    page.locator('#newChat').click()
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path='/mnt/data/voxbridge-mobile-preview.png',full_page=True)
    assert page.locator('body').evaluate('(el)=>el.scrollWidth <= innerWidth + 1')
    assert not errors,errors
    print('Browser checks passed: English/Ukrainian, creation, guest flow, text reply and mobile viewport. AI mocked.')
    browser.close()
