# Backend del calendario (carpeta `back/`) (MongoDB + login)

1. Conseguí una base de MongoDB:
   - **Atlas (gratis):** creá un cluster M0 en mongodb.com/atlas, un usuario de base de datos, y en *Network Access* permití tu IP (o `0.0.0.0/0` para el deploy). Copiá la connection string.
   - **Local:** instalá MongoDB Community y usá `mongodb://127.0.0.1:27017/calendario`.
2. `copy .env.example .env` y completá `MONGODB_URI` y `JWT_SECRET`
   (generá la clave con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
3. `npm install` y después `npm start`.
4. Abrí http://localhost:3000 → aparece el login. "Crear cuenta" registra el usuario.

Las fechas que ya tenías guardadas en el navegador se suben a tu cuenta la primera vez que entrás.

## Deploy: front en Vercel, backend en Render
1. **Atlas:** en *Network Access* agregá `0.0.0.0/0` (Render no tiene IP fija).
2. **Render:** *New → Blueprint* (usa `render.yaml`) o *New → Web Service* con Root Directory `back`, build `npm install`, start `npm start`.
   Cargá en Environment: `MONGODB_URI`, `JWT_SECRET` y `CORS_ORIGIN` (tu dominio de Vercel, sin barra final).
   Render te da una URL tipo `https://calendar-api.onrender.com`.
3. **Front:** si la URL de Render es distinta de `https://calendar-api.onrender.com`, cambiala en `front/config.js` (`window.API_URL`).
4. **Vercel:** importá el repo con Root Directory `front`, Framework Preset *Other* y sin build.
5. Volvé a Render y poné el dominio final de Vercel en `CORS_ORIGIN`.

El plan gratis de Render se duerme tras 15 min sin uso: la primera carga después puede tardar ~50 s.

## API
- `POST /api/register` · `POST /api/login` → `{ token, email }` (body: `{ email, password }`)
- `GET /api/events` · `PUT /api/events` (reemplaza la lista completa) — requieren `Authorization: Bearer <token>`
