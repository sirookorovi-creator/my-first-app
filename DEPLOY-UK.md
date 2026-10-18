# VOXBRIDGE: безкоштовний запуск на Cloudflare (без оплати OpenAI)

**Зараз:** код готовий до перевірки, база `voxbridge-db` уже створена і внесена у `wrangler.jsonc`. Сайт ще не опубліковано.

**Грошей не потрібно на початковий тест:** залишайтеся на **Cloudflare Workers Free**, де Workers AI включає **10 000 neurons за добу**. Для використаних моделей `@cf/meta/m2m100-1.2b` і `@cf/openai/whisper-large-v3-turbo` *не потрібний окремий платний OpenAI API-ключ*. На Cloudflare Free квота не продовжується платно: після перевищення запити повертають помилку. Не переходьте на Workers Paid.

## Крок 1. Знайти Account ID
Увійдіть на https://dash.cloudflare.com/ . Відкрийте **Workers & Pages** або сторінку огляду акаунта. Біля **Account ID** скопіюйте код (32 символи). Це ідентифікатор, а не пароль.

## Крок 2. Створити API Token
У Cloudflare відкрийте **My Profile → API Tokens → Create Token**. Дайте доступ **лише до свого акаунта** й лише необхідні права для Workers (редагування/розгортання) і D1 (редагування бази). Не використовуйте глобальний API-ключ та не надавайте доступ до всіх акаунтів.

## Крок 3. Безпечно підключити GitHub
Відкрийте https://github.com/sirookorovi-creator/my-first-app/settings/secrets/actions

Створіть два **Repository secrets** (ніде не показуйте їхні значення):
- `CLOUDFLARE_ACCOUNT_ID`: ваш Account ID Cloudflare.
- `CLOUDFLARE_API_TOKEN`: секретний API-токен Cloudflare.

Database ID вже є у конфігурації, вводити його знову не треба.

## Крок 4. Опублікувати
Відкрийте https://github.com/sirookorovi-creator/my-first-app/actions/workflows/deploy.yml і виберіть **Run workflow**.

Процес перевірить код, виконає міграцію D1 і розгорне сайт на `*.workers.dev`. Платний OpenAI API у коді **не використовується**.

Якщо з’явилася помилка, відкрийте перевірку в **Actions**, зробіть скриншот тексту помилки і надішліть у ChatGPT. **Не пересилайте токен, пароль чи API-ключ.**

## Крок 5. Задати секрети без платних сервісів
У Cloudflare → **Workers & Pages → voxbridge-mvp → Settings → Variables and Secrets** додайте:
- `RATE_LIMIT_SALT` — 20+ випадкових символів.
- `LINK_SECRET` — інші 24+ випадкових символи.

На Mac команда `openssl rand -hex 32` видає один випадковий рядок; запустіть двічі й збережіть у менеджері паролів. **Не публікуйте їх.** Не змінюйте `LINK_SECRET` для чинної бази без плану міграції, інакше не зможете відновити посилання учасника.

Секрет `OPENAI_API_KEY` **не додаємо**, він більше не потрібен.

## Крок 6. Перевірити, не витрачаючи грошей
1. Відкрийте адресу `https://voxbridge-mvp.<ваш-піддомен>.workers.dev/api/health`. Має бути `{"ok":true,"aiConfigured":true,"aiProvider":"cloudflare-workers-ai"}`. Це тільки ознака наявності прив’язки AI, не доказ якісного перекладу.
2. Відкрийте основну сторінку, створіть кімнату для двох мов, перевірте текстовий переклад.
3. На іншому телефоні відкрийте посилання гостя, дайте відповідь.
4. Перевірте голос із iPhone Safari і Android Chrome окремо. Аудіоформати WebM/MP4 потрібно реально випробувати; іноді потрібні виправлення.
5. Перевірте використання AI-квоти в Cloudflare Workers AI Dashboard. Якщо ліміт вичерпано, переклади призупиняться до наступної доби.

## Поки не публікувати широко
- Потрібні антибот-захист, перевірка політики приватності та тестування на реальних телефонах.
- Переклад може помилятися. Не використовуйте в критичних ситуаціях.
- Посилання приватні, але немає end-to-end шифрування та підтвердження особи.
- Тести у GitHub використовують заглушки AI; реальну роботу перевіряють лише після деплою.
- Репозиторій публічний: секрети — тільки у GitHub Secrets та Cloudflare Settings.

Офіційні джерела:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/
- https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/
