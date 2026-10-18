# VOXBRIDGE — розгортання через GitHub Actions

Ваш уже авторизований звичайний браузер потрібний лише для одноразового створення токена й збереження його в GitHub. Вхід у віддалений браузер ChatGPT не потрібний.

## Уже налаштовано

- Репозиторій: `sirookorovi-creator/my-first-app`, гілка `main`.
- Cloudflare Account ID: `f3dd4d2ecfdd0c89fdb864b0cb4e6dff` — уже в `wrangler.jsonc`.
- Worker: `voxbridge-mvp`, безкоштовна адреса `*.workers.dev`.
- База `voxbridge-db`: `b39140d9-b8a5-4ca0-9cee-73b9c1be26f7`.
- Розпізнавання й переклад: Workers AI. OpenAI API-ключ не використовується.

## Потрібна авторизація: токен Cloudflare у GitHub Secrets

1. У своєму відкритому кабінеті Cloudflare відкрийте **Account API Tokens → Create Token → Custom token**. Назва — `VOXBRIDGE GitHub Deploy`.
2. Обмежте ресурси акаунтом `Roma.siroochenko@gmail.com` і додайте дозволи:

   | Ресурс | Дозвіл | Рівень |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit / Write |
   | Account | D1 | Edit / Write |
   | Account | Workers AI | Read |

   Якщо інтерфейс використовує нові ролі Workers, створення першого Worker потребує **Workers Admin** на рівні продукту цього акаунта. Після першого запуску токен можна звузити до `voxbridge-mvp`. Доступ до DNS, оплати та інших акаунтів не потрібний.
3. Створіть токен і скопіюйте його. **Не надсилайте значення в чат і не додавайте у файли репозиторію.**
4. GitHub → репозиторій → **Settings → Secrets and variables → Actions → New repository secret**:
   - **Name:** `CLOUDFLARE_API_TOKEN`
   - **Secret:** скопійований токен.
   - Натисніть **Add secret**.

Після цього перезапустіть невдалий запуск **Deploy VOXBRIDGE**, або відкрийте **Actions → Deploy VOXBRIDGE → Run workflow** для `main`. Надалі зміни в `main` запускають розгортання автоматично. Окремий секрет Account ID не потрібний.

## Що GitHub робить автоматично

1. Перевіряє JavaScript і запускає тести.
2. Зберігає наявний піддомен `workers.dev`; якщо його ще немає — реєструє `voxbridge-<перші 12 символів Account ID>`.
3. Застосовує SQL-міграцію D1 без видалення чинних даних і розгортає Worker зі статичними файлами.
4. Створює відсутні випадкові `LINK_SECRET` та `RATE_LIMIT_SALT`, не друкуючи значень у журнали. Чинні ключі зберігаються. Якщо `LINK_SECRET` відсутній, але в базі є розмови, сценарій зупиняється.
5. Перевіряє сайт, API, створення кімнати, окремі права власника й гостя, переклад українська → англійська, синтетичне англійське аудіо → український переклад і збереження повідомлень.
6. Видаляє лише створену ним тестову розмову. Адреса перевіреного сайту з'являється у підсумку GitHub Actions.

Кожен запуск використовує одну тимчасову кімнату та два AI-повідомлення в межах установлених лімітів. Якщо безкоштовна квота вичерпана, перевірка повідомить про помилку. Сценарій не змінює план і не підключає оплату.

## Бюджет

Залишайте **Workers Free**. Workers AI Free надає 10 000 Neurons на добу; після вичерпання квоти запити завершуються помилкою. Workers, D1 і GitHub Actions мають свої ліміти. Платні плани, купівля домену й OpenAI API для цього запуску не потрібні.

Синтетичний голосовий тест не замінює перевірку запису з мікрофона й озвучення на справжніх iPhone/Android.

Офіційна документація:
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- https://developers.cloudflare.com/workers-ai/platform/pricing/

Альтернативний вбудований шлях: **Workers & Pages → Create application → Connect GitHub**, репозиторій `my-first-app`, гілка `main`, build `npm run build`, deploy `npx wrangler deploy`. Для цього шляху службові секрети потрібно додати в налаштуваннях Worker самостійно. Оберіть один спосіб автоматичного розгортання одного Worker.
