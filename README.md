# Chat en vivo multiusuario

Chat compartido por varias personas. Incluye un servidor HTTP ligero en PowerShell (sin instalar nada), interfaz web y persistencia de mensajes en `messages.json`.

## Uso rápido

1. Doble clic en **`iniciar-chat.bat`**.
2. Se abre `http://localhost:3000`. Escribe tu nombre y entra.
3. Abre la misma URL en otro navegador o equipo, entra con otro nombre y verás los mensajes compartidos.

Para detener el servidor, cierra la ventana del servidor o pulsa `Ctrl+C`.

## Acceso desde otros equipos de la red

El servidor escucha solo en `localhost` por defecto. Para compartirlo en la red local:

1. Abre PowerShell **como administrador** en esta carpeta y ejecuta una sola vez:

   ```powershell
   netsh http add urlacl url=http://+:3000/ user=Todos
   ```

2. Inicia el servidor con:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1 -Bind +
   ```

3. En los otros equipos abre `http://TU-IP:3000` (p. ej. `http://192.168.1.20:3000`). Si el firewall bloquea el puerto, permite el puerto 3000 en TCP.

## Cambiar el puerto

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1 -Port 3001
```

## Archivos

- `index.html` — interfaz (acceso con nombre, sala, mensajes).
- `styles.css` — diseño adaptable, tema claro/oscuro.
- `app.js` — cliente: envío, presencia, "escribiendo…", emojis.
- `server.ps1` — API HTTP y estado compartido.
- `messages.json` — historial (se crea automáticamente).
