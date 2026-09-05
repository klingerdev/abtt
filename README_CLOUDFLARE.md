# ABTT Site — versão Cloudflare corrigida

## Melhorias desta versão
- Cadastro, edição e exclusão revisados no painel administrativo.
- Mensagens de erro detalhadas para D1, R2, sessão e conexão.
- Criação automática das tabelas caso a migração ainda não tenha sido aplicada.
- Exclusão segura: o banco é atualizado antes da remoção do arquivo no R2.
- Validação do tipo e do tamanho dos arquivos enviados.
- Tradução do site e do painel para português (Brasil), inglês, espanhol e francês.
- Idioma escolhido permanece salvo no navegador.

Esta versão foi reorganizada para Cloudflare Workers + Static Assets + D1 + R2.

## Estrutura
- `public/` — site público, painel admin, CSS, JS e imagens estáticas.
- `src/index.js` — Worker com API, autenticação administrativa, D1 e R2.
- `migrations/0001_initial.sql` — tabelas do banco D1.
- `wrangler.jsonc` — configuração Cloudflare.

## O que foi removido da arquitetura anterior
O ZIP recebido misturava arquivos de ABTT com um projeto DM/Supabase/Netlify. Esta versão não depende de Netlify nem Supabase.

## 1. Requisitos no computador
Instale Node.js 20+ e abra um terminal dentro desta pasta.

```bash
npm install
npx wrangler login
```

## 2. Criar o banco D1
```bash
npx wrangler d1 create abtt-db
```

O comando exibirá um `database_id`. Abra `wrangler.jsonc` e substitua:

`COLE_AQUI_O_DATABASE_ID`

pelo ID retornado pela Cloudflare.

## 3. Criar o bucket R2 para imagens e vídeos
```bash
npx wrangler r2 bucket create abtt-media
```

O nome já está configurado em `wrangler.jsonc` como `abtt-media`.

## 4. Criar as tabelas no D1
Depois de colocar o database_id no `wrangler.jsonc`:

```bash
npm run db:remote
```

Equivalente a:

```bash
npx wrangler d1 migrations apply abtt-db --remote
```

O Worker também verifica e cria as tabelas automaticamente. Mesmo assim, recomenda-se aplicar a migração para manter o ambiente documentado.

## 5. Definir a senha do administrador
O usuário padrão é `admin` e pode ser alterado em `wrangler.jsonc` no campo `ADMIN_USER`.

A senha NÃO fica salva no código. Cadastre como secret:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Digite uma senha forte quando o terminal solicitar.

## 6. Testar localmente
Para usar D1 local:

```bash
npm run db:local
npm run dev
```

Observação: para testar o login administrativo localmente, crie um arquivo `.dev.vars` (não envie ao GitHub):

```env
ADMIN_PASSWORD=sua-senha-de-teste
```

## 7. Publicar
```bash
npm run deploy
```

Ao final, a Cloudflare mostrará uma URL `*.workers.dev`.

## 8. Painel administrativo
Acesse:

`https://SEU-SITE.workers.dev/admin.html`

Usuário: o valor de `ADMIN_USER` (por padrão `admin`).
Senha: a definida em `ADMIN_PASSWORD`.

## 9. Domínio próprio
No painel Cloudflare, abra o Worker `abtt-site` e use **Settings / Domains & Routes** para adicionar seu domínio personalizado.

## Segurança
- A senha administrativa usa Secret da Cloudflare e não aparece no frontend.
- A sessão administrativa é gravada em cookie `HttpOnly`, `Secure` e `SameSite=Strict` por 8 horas.
- D1 não é acessado diretamente pelo navegador; somente pelo Worker.
- Arquivos do R2 são entregues pelo Worker e não precisam de bucket público.
- Upload limitado a 25 MB por arquivo nesta versão.

## Observação
Caso altere o nome do banco ou bucket, atualize também `wrangler.jsonc`.
