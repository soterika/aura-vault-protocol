# Getting Started with Aura Vault
### Guía de Inicio con Aura Vault

> **Estimated time / Tiempo estimado:** 10 minutes / 10 minutos  
> **Difficulty / Dificultad:** Beginner / Principiante  
> **Tested by / Probado por:** 3 non-technical users / 3 usuarios no técnicos

---

## English

Welcome to Aura Vault — a yield vault built on Stellar's Soroban smart contract platform. This guide walks you through everything you need to make your first deposit, from installing a wallet to watching your balance grow.

### Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install Freighter Wallet](#2-install-freighter-wallet)
3. [Fund Your Wallet](#3-fund-your-wallet)
4. [Connect to the App](#4-connect-to-the-app)
5. [Make Your First Deposit](#5-make-your-first-deposit)
6. [What Happens Next](#6-what-happens-next)

---

### 1. Prerequisites

Before you begin, make sure you have:

| Requirement | Details |
|---|---|
| A modern browser | Chrome, Firefox, Brave, or Edge (latest version) |
| An internet connection | Stable connection required |
| XLM for fees | A small amount of XLM (Lumens) to cover Stellar network fees (~0.1 XLM is enough to start) |
| Underlying tokens | The token accepted by the vault (e.g., USDC on Stellar) — ask the vault admin which token is accepted |

> **Note:** You do not need any technical knowledge or coding experience. This guide is designed for everyone.

---

### 2. Install Freighter Wallet

Freighter is the official browser extension wallet for Stellar. It stores your keys securely and signs transactions on your behalf.

**Step 1 — Go to the Freighter website**

Open your browser and navigate to [https://freighter.app](https://freighter.app).

> **Screenshot placeholder:** `[Screenshot: Freighter homepage with "Add to Chrome" button highlighted]`

**Step 2 — Add the extension**

Click **"Add to Chrome"** (or the button for your browser). Your browser will open the extension store. Click **"Add extension"** to confirm.

> **Screenshot placeholder:** `[Screenshot: Browser extension store page for Freighter with "Add to Chrome" button]`

**Step 3 — Open Freighter**

After installation, click the puzzle-piece icon in your browser toolbar to find Freighter, then click its icon to open it.

> **Screenshot placeholder:** `[Screenshot: Browser toolbar with Freighter extension icon pinned]`

**Step 4 — Create a new wallet**

On the Freighter welcome screen:

1. Click **"Create new wallet"**.
2. Choose a strong password. Write it down somewhere safe — if you forget it, you cannot recover it without your seed phrase.
3. Click **"Next"**.

> **Screenshot placeholder:** `[Screenshot: Freighter "Create new wallet" screen with password fields]`

**Step 5 — Save your seed phrase**

Freighter will show you a 12-word seed phrase. This is the master key to your wallet.

- Write all 12 words down **on paper**, in order.
- Store the paper somewhere safe (not in a photo or digital document).
- **Never share your seed phrase with anyone.** Aura support will never ask for it.

Click the checkbox confirming you have saved the phrase, then click **"Confirm"**.

> **Screenshot placeholder:** `[Screenshot: Freighter seed phrase screen with 12 words and "I have saved my secret phrase" checkbox]`

**Step 6 — Verify your seed phrase**

Freighter will ask you to confirm a few of the words in order. Select the correct words from the list, then click **"Confirm"**.

> **Screenshot placeholder:** `[Screenshot: Freighter seed phrase verification step]`

Your Freighter wallet is now ready. You will see your Stellar address (starting with `G`) in the top bar.

---

### 3. Fund Your Wallet

Before you can deposit into the vault, you need tokens in your wallet.

**Step 1 — Copy your Stellar address**

Open Freighter and click the copy icon next to your address (it looks like `GABCDE...WXYZ`). This is your public address — safe to share.

> **Screenshot placeholder:** `[Screenshot: Freighter main screen with address copy button highlighted]`

**Step 2 — Switch to the correct network**

In the top-right of Freighter, check that the network matches the vault (Mainnet or Testnet). Click the network name to switch if needed.

> **Screenshot placeholder:** `[Screenshot: Freighter network selector showing Mainnet / Testnet options]`

**Step 3 — Acquire XLM**

You need a small amount of XLM to activate your account and pay transaction fees:

- **Testnet only (free):** Visit [https://laboratory.stellar.org/#account-creator](https://laboratory.stellar.org/#account-creator), paste your address, and click **"Get test lumens"**.
- **Mainnet:** Purchase XLM from any exchange (Coinbase, Binance, Kraken, etc.) and withdraw to your Stellar address.

> **Screenshot placeholder:** `[Screenshot: Stellar Laboratory friendbot page with address field and "Get test lumens" button]`

**Step 4 — Acquire the vault's underlying token**

The vault holds a specific token (e.g., USDC). You can:

- Swap XLM for USDC on a Stellar DEX like [StellarX](https://www.stellarx.com) or [Lobstr](https://lobstr.co).
- Receive USDC from another wallet.

> **Screenshot placeholder:** `[Screenshot: StellarX swap interface swapping XLM to USDC]`

**Step 5 — Add a trustline for the token**

Stellar requires you to "trust" a token before your wallet can hold it. In Freighter:

1. Click **"Manage Assets"** (or the `+` icon).
2. Search for the token by its code (e.g., `USDC`).
3. Select the correct issuer address (verify this with the Aura app or official docs).
4. Click **"Add trustline"** and approve the transaction.

> **Screenshot placeholder:** `[Screenshot: Freighter "Manage Assets" screen with USDC trustline being added]`

---

### 4. Connect to the App

**Step 1 — Open the Aura Vault app**

Navigate to the Aura Vault web application in your browser.

> **Screenshot placeholder:** `[Screenshot: Aura Vault app homepage]`

**Step 2 — Click "Connect Wallet"**

Find the **"Connect Wallet"** button in the top-right corner of the page and click it.

> **Screenshot placeholder:** `[Screenshot: Aura Vault app header with "Connect Wallet" button highlighted]`

**Step 3 — Select Freighter**

A modal will appear listing supported wallets. Click **"Freighter"**.

> **Screenshot placeholder:** `[Screenshot: Wallet selection modal with Freighter option]`

**Step 4 — Approve the connection in Freighter**

Freighter will open a popup asking for permission to connect to the site. Review the site address, then click **"Approve"**.

> **Screenshot placeholder:** `[Screenshot: Freighter connection approval popup with "Approve" button]`

**Step 5 — Confirm you are connected**

Back in the app, you should see your wallet address (truncated, like `GABCD...WXYZ`) in the top-right. This confirms a successful connection.

> **Screenshot placeholder:** `[Screenshot: Aura Vault app header showing connected wallet address]`

---

### 5. Make Your First Deposit

**Step 1 — Navigate to the Deposit tab**

On the Aura Vault app's main page, click the **"Deposit"** tab or button.

> **Screenshot placeholder:** `[Screenshot: Aura Vault deposit form with amount input field]`

**Step 2 — Enter the deposit amount**

In the **"Amount"** field, type the number of tokens you want to deposit. You can also click **"Max"** to deposit your full balance.

> **Tip:** Start with a small amount while you get familiar with the process.

> **Screenshot placeholder:** `[Screenshot: Deposit form with amount "100" entered and "Max" button visible]`

**Step 3 — Approve token spending (first time only)**

If this is your first interaction with the vault, the app may ask you to approve the vault contract to spend your tokens. A Freighter popup will appear — review the amount, then click **"Approve"**.

> **Screenshot placeholder:** `[Screenshot: Freighter approval popup for token allowance with contract address and amount shown]`

**Step 4 — Click "Deposit"**

Click the **"Deposit"** button. Freighter will open a transaction popup showing:

- The vault contract address
- The amount being deposited
- The estimated network fee (usually < 0.01 XLM)

> **Screenshot placeholder:** `[Screenshot: Freighter transaction signing popup with deposit details and "Approve" button]`

**Step 5 — Approve the transaction**

Review the details and click **"Approve"** in Freighter. The transaction will be submitted to the Stellar network.

> **Screenshot placeholder:** `[Screenshot: Transaction submitted confirmation screen in Aura Vault app]`

**Step 6 — View your vault shares**

After the transaction confirms (usually within 5 seconds), the app will show your **vault share balance**. This is the number of shares representing your ownership in the vault.

> **Screenshot placeholder:** `[Screenshot: Aura Vault dashboard showing vault share balance and estimated token value]`

> **How shares work:** The first depositor receives shares equal to their deposit amount (1:1 ratio). Later depositors receive `floor(amount × totalShares / totalAssets)` shares. As the vault accumulates yield, each share becomes redeemable for more tokens. See [Share Math](../share-math.md) for a full explanation.

---

### 6. What Happens Next

- **Yield accrues automatically.** Keepers call the `harvest` function to inject yield into the vault. This increases the value of every share without any action from you.
- **To withdraw,** navigate to the **"Withdraw"** tab, enter the number of shares to redeem, and approve the transaction. You will receive the underlying tokens proportional to your shares.
- **Monitor your balance** using the vault's dashboard or by querying `total_assets()` and `balance_of()` directly on-chain.
- **Performance fee:** A 10% performance fee is applied to harvested yield. This fee goes to the treasury and does not affect your principal.

> **Need help?** Check the [Smart Contract API Reference](../smart-contract-api.md) for technical details, or join the Aura community Discord.

---
---

## Español

Bienvenido a Aura Vault — un vault de rendimiento construido sobre la plataforma de contratos inteligentes Soroban de Stellar. Esta guía te llevará paso a paso desde la instalación de una billetera hasta tu primer depósito.

### Tabla de Contenidos

1. [Requisitos Previos](#1-requisitos-previos)
2. [Instalar la Billetera Freighter](#2-instalar-la-billetera-freighter)
3. [Fondear tu Billetera](#3-fondear-tu-billetera)
4. [Conectarte a la Aplicación](#4-conectarte-a-la-aplicación)
5. [Hacer tu Primer Depósito](#5-hacer-tu-primer-depósito)
6. [Qué Sucede Después](#6-qué-sucede-después)

---

### 1. Requisitos Previos

Antes de comenzar, asegúrate de tener:

| Requisito | Detalles |
|---|---|
| Un navegador moderno | Chrome, Firefox, Brave o Edge (versión más reciente) |
| Conexión a internet | Se requiere conexión estable |
| XLM para comisiones | Una pequeña cantidad de XLM (Lumens) para cubrir las comisiones de la red Stellar (~0.1 XLM es suficiente para empezar) |
| Tokens subyacentes | El token aceptado por el vault (por ejemplo, USDC en Stellar) — consulta al administrador del vault qué token se acepta |

> **Nota:** No necesitas conocimientos técnicos ni experiencia en programación. Esta guía está diseñada para todos.

---

### 2. Instalar la Billetera Freighter

Freighter es la extensión oficial de billetera para Stellar. Almacena tus claves de forma segura y firma transacciones en tu nombre.

**Paso 1 — Ve al sitio web de Freighter**

Abre tu navegador y dirígete a [https://freighter.app](https://freighter.app).

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Página de inicio de Freighter con el botón "Agregar a Chrome" resaltado]`

**Paso 2 — Agrega la extensión**

Haz clic en **"Agregar a Chrome"** (o el botón correspondiente a tu navegador). Tu navegador abrirá la tienda de extensiones. Haz clic en **"Agregar extensión"** para confirmar.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Página de la tienda de extensiones del navegador para Freighter]`

**Paso 3 — Abre Freighter**

Después de la instalación, haz clic en el ícono del rompecabezas en la barra de herramientas de tu navegador para encontrar Freighter, luego haz clic en su ícono para abrirlo.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Barra de herramientas del navegador con el ícono de extensión de Freighter anclado]`

**Paso 4 — Crea una nueva billetera**

En la pantalla de bienvenida de Freighter:

1. Haz clic en **"Crear nueva billetera"**.
2. Elige una contraseña segura. Escríbela en algún lugar seguro — si la olvidas, no podrás recuperarla sin tu frase semilla.
3. Haz clic en **"Siguiente"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Pantalla "Crear nueva billetera" de Freighter con campos de contraseña]`

**Paso 5 — Guarda tu frase semilla**

Freighter te mostrará una frase semilla de 12 palabras. Esta es la clave maestra de tu billetera.

- Escribe las 12 palabras **en papel**, en orden.
- Guarda el papel en un lugar seguro (no en una foto ni en un documento digital).
- **Nunca compartas tu frase semilla con nadie.** El soporte de Aura nunca te la pedirá.

Haz clic en la casilla de verificación confirmando que guardaste la frase, luego haz clic en **"Confirmar"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Pantalla de frase semilla de Freighter con 12 palabras y casilla "He guardado mi frase secreta"]`

**Paso 6 — Verifica tu frase semilla**

Freighter te pedirá que confirmes algunas de las palabras en orden. Selecciona las palabras correctas de la lista, luego haz clic en **"Confirmar"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Paso de verificación de frase semilla de Freighter]`

Tu billetera Freighter está lista. Verás tu dirección de Stellar (comenzando con `G`) en la barra superior.

---

### 3. Fondear tu Billetera

**Paso 1 — Copia tu dirección de Stellar**

Abre Freighter y haz clic en el ícono de copiar junto a tu dirección (se ve como `GABCDE...WXYZ`). Esta es tu dirección pública — es seguro compartirla.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Pantalla principal de Freighter con el botón de copiar dirección resaltado]`

**Paso 2 — Cambia a la red correcta**

En la esquina superior derecha de Freighter, verifica que la red coincida con el vault (Mainnet o Testnet). Haz clic en el nombre de la red para cambiar si es necesario.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Selector de red de Freighter mostrando opciones de Mainnet / Testnet]`

**Paso 3 — Adquiere XLM**

Necesitas una pequeña cantidad de XLM para activar tu cuenta y pagar las comisiones de transacción:

- **Solo Testnet (gratis):** Visita [https://laboratory.stellar.org/#account-creator](https://laboratory.stellar.org/#account-creator), pega tu dirección y haz clic en **"Obtener lumens de prueba"**.
- **Mainnet:** Compra XLM en cualquier exchange (Coinbase, Binance, Kraken, etc.) y retira a tu dirección de Stellar.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Página de Stellar Laboratory friendbot con campo de dirección y botón "Obtener lumens de prueba"]`

**Paso 4 — Adquiere el token subyacente del vault**

El vault mantiene un token específico (por ejemplo, USDC). Puedes:

- Intercambiar XLM por USDC en un DEX de Stellar como [StellarX](https://www.stellarx.com) o [Lobstr](https://lobstr.co).
- Recibir USDC de otra billetera.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Interfaz de intercambio de StellarX cambiando XLM por USDC]`

**Paso 5 — Agrega una línea de confianza para el token**

Stellar requiere que "confíes" en un token antes de que tu billetera pueda tenerlo. En Freighter:

1. Haz clic en **"Administrar activos"** (o el ícono `+`).
2. Busca el token por su código (por ejemplo, `USDC`).
3. Selecciona la dirección del emisor correcta (verifícala con la app de Aura o la documentación oficial).
4. Haz clic en **"Agregar línea de confianza"** y aprueba la transacción.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Pantalla "Administrar activos" de Freighter con línea de confianza USDC siendo agregada]`

---

### 4. Conectarte a la Aplicación

**Paso 1 — Abre la app de Aura Vault**

Navega a la aplicación web de Aura Vault en tu navegador.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Página de inicio de la app de Aura Vault]`

**Paso 2 — Haz clic en "Conectar Billetera"**

Encuentra el botón **"Conectar Billetera"** en la esquina superior derecha de la página y haz clic en él.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Encabezado de la app de Aura Vault con el botón "Conectar Billetera" resaltado]`

**Paso 3 — Selecciona Freighter**

Aparecerá un modal con las billeteras compatibles. Haz clic en **"Freighter"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Modal de selección de billetera con la opción Freighter]`

**Paso 4 — Aprueba la conexión en Freighter**

Freighter abrirá una ventana emergente solicitando permiso para conectarse al sitio. Revisa la dirección del sitio, luego haz clic en **"Aprobar"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Ventana emergente de aprobación de conexión de Freighter con el botón "Aprobar"]`

**Paso 5 — Confirma que estás conectado**

De vuelta en la app, deberías ver tu dirección de billetera (truncada, como `GABCD...WXYZ`) en la esquina superior derecha. Esto confirma una conexión exitosa.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Encabezado de la app de Aura Vault mostrando la dirección de billetera conectada]`

---

### 5. Hacer tu Primer Depósito

**Paso 1 — Navega a la pestaña de Depósito**

En la página principal de la app de Aura Vault, haz clic en la pestaña o botón **"Depósito"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Formulario de depósito de Aura Vault con campo de entrada de monto]`

**Paso 2 — Ingresa el monto del depósito**

En el campo **"Monto"**, escribe el número de tokens que deseas depositar. También puedes hacer clic en **"Máx"** para depositar tu saldo completo.

> **Consejo:** Comienza con una pequeña cantidad mientras te familiarizas con el proceso.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Formulario de depósito con monto "100" ingresado y botón "Máx" visible]`

**Paso 3 — Aprueba el gasto de tokens (solo la primera vez)**

Si esta es tu primera interacción con el vault, la app puede pedirte que apruebes que el contrato del vault gaste tus tokens. Aparecerá una ventana emergente de Freighter — revisa el monto, luego haz clic en **"Aprobar"**.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Ventana emergente de aprobación de Freighter para el permiso de tokens con la dirección del contrato y monto mostrados]`

**Paso 4 — Haz clic en "Depositar"**

Haz clic en el botón **"Depositar"**. Freighter abrirá una ventana emergente de transacción mostrando:

- La dirección del contrato del vault
- El monto que se deposita
- La comisión de red estimada (generalmente < 0.01 XLM)

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Ventana emergente de firma de transacción de Freighter con detalles del depósito y botón "Aprobar"]`

**Paso 5 — Aprueba la transacción**

Revisa los detalles y haz clic en **"Aprobar"** en Freighter. La transacción se enviará a la red Stellar.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Pantalla de confirmación de transacción enviada en la app de Aura Vault]`

**Paso 6 — Ve el saldo de tus participaciones del vault**

Después de que la transacción confirme (generalmente en 5 segundos), la app mostrará tu **saldo de participaciones del vault**. Este es el número de participaciones que representan tu propiedad en el vault.

> **Marcador de posición de captura de pantalla:** `[Captura de pantalla: Panel de Aura Vault mostrando el saldo de participaciones del vault y el valor estimado en tokens]`

> **Cómo funcionan las participaciones:** El primer depositante recibe participaciones iguales a su monto de depósito (relación 1:1). Los depositantes posteriores reciben `floor(monto × totalParticipaciones / totalActivos)` participaciones. A medida que el vault acumula rendimiento, cada participación se puede canjear por más tokens. Consulta [Matemáticas de Participaciones](../share-math.md) para una explicación completa.

---

### 6. Qué Sucede Después

- **El rendimiento se acumula automáticamente.** Los keepers llaman a la función `harvest` para inyectar rendimiento en el vault. Esto aumenta el valor de cada participación sin ninguna acción de tu parte.
- **Para retirar,** navega a la pestaña **"Retirar"**, ingresa el número de participaciones a canjear y aprueba la transacción. Recibirás los tokens subyacentes proporcionales a tus participaciones.
- **Monitorea tu saldo** usando el panel del vault o consultando `total_assets()` y `balance_of()` directamente en la blockchain.
- **Comisión de rendimiento:** Se aplica una comisión de rendimiento del 10% al rendimiento cosechado. Esta comisión va a la tesorería y no afecta tu capital.

> **¿Necesitas ayuda?** Consulta la [Referencia de API de Contrato Inteligente](../smart-contract-api.md) para detalles técnicos, o únete al Discord de la comunidad de Aura.

---

*Issues: [#384](https://github.com/soterika/aura-vault-protocol/issues/384)*
