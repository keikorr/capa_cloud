# Publicação de versões do aplicativo do totem

Esta pasta alimenta o botão **"Atualizar aplicativo"** do Painel do Operador (aba
*Identificação do Totem*). O app consulta `GET /api/v1/app/version`, compara o `versionCode`
com o instalado e, se houver versão maior, baixa o APK daqui.

## Como publicar uma versão nova

1. **Aumente a versão** em `APK-Capaxero/app/build.gradle.kts`:

   ```kotlin
   versionCode = 3          // SEMPRE maior que o publicado — é por ele que o totem decide
   versionName = "1.2.0"    // texto exibido ao operador
   ```

2. **Gere o APK**:

   ```
   cd APK-Capaxero
   ./gradlew assembleDebug
   ```

3. **Copie para cá**, substituindo o arquivo:

   ```
   cp app/build/outputs/apk/debug/app-debug.apk ../capaxero_cloud/public/downloads/capaxero-totem.apk
   ```

4. **Atualize `app-version.json`** com o mesmo `versionCode`/`versionName` do passo 1:

   ```json
   {
     "versionCode": 3,
     "versionName": "1.2.0",
     "apkFile": "capaxero-totem.apk",
     "notes": "O que mudou nesta versão."
   }
   ```

Não precisa reiniciar o servidor: `tamanho`, `sha256` e data de publicação são lidos do arquivo
a cada consulta (o hash é recalculado só quando o APK muda).

## Regras que não dá para contornar

- **Mesma chave de assinatura.** O Android recusa a atualização se o APK novo estiver assinado
  com chave diferente do instalado (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Builds de debug
  feitas na mesma máquina usam o mesmo `~/.android/debug.keystore`, então funcionam entre si —
  mas um APK de debug **não** atualiza um de release, nem o contrário.

- **`versionCode` só cresce.** Publicar um número igual ou menor faz o totem responder
  "já está na versão mais recente" e ignorar o arquivo.

- **A confirmação na tela é obrigatória.** O operador precisa tocar em "Instalar" no diálogo do
  Android, e na primeira vez também autorizar este app a instalar pacotes (o próprio botão leva
  para essa tela). Atualização 100% silenciosa exigiria provisionar o app como **Device Owner**
  do aparelho — o que envolve reset de fábrica e configuração por ADB em cada totem.

## Arquivos

| Arquivo | Papel |
|---|---|
| `capaxero-totem.apk` | binário servido ao totem e ao download manual |
| `app-version.json` | manifesto lido por `GET /api/v1/app/version` |
