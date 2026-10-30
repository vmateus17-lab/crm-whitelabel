# CRM Whitelabel

CRM em português para leads, pipeline, clientes, financeiro, orçamentos, tarefas e lembretes. A distribuição contém código e migrações de estrutura, sem contas, registros comerciais, arquivos enviados ou configuração de uma instalação existente.

## Instalação

Requisitos: Node.js 22.16+ e um projeto **novo e vazio** no Supabase.

```sh
npm ci
cp .env.example .env
```

Preencha `.env` com a URL e a chave pública do seu novo projeto. Variáveis `VITE_*` são públicas no navegador: nunca coloque chaves de serviço nelas. Não versione `.env`.

Com a CLI do Supabase autenticada, vincule **somente o projeto novo** e aplique as migrações:

```sh
supabase link --project-ref YOUR_NEW_PROJECT_REF
supabase db push
npm run dev
```

No painel do projeto, configure a URL do site e os redirecionamentos para o seu domínio. `supabase/config.toml` contém apenas a configuração local. Crie a primeira conta por convite no painel de autenticação; o cadastro público deve permanecer desativado.

## Identidade visual

Abra **Configurações → Identidade visual**. O nome admite de 1 a 12 caracteres. O logo deve ser PNG, JPG ou WebP, quadrado, entre 32 e 8192 pixels de lado, com até 5 MB. A imagem é convertida para PNG de 512 × 512 antes de ser salva, sem os metadados do arquivo original.

A identidade fica no banco da instalação e é pública, pois também aparece antes do login. A primeira conta autenticada que salvar a identidade se torna sua responsável; somente essa conta poderá alterá-la depois. Faça a configuração inicial antes de convidar outros usuários. Se necessário, o administrador do banco pode transferir `crm_branding.owner_id` para outra conta existente.

O nome e o logo são usados no menu, no login, no carregamento, no título das abas, no favicon, no manifesto e nas notificações. Aplicativos já instalados podem depender da atualização do navegador ou de reinstalação para atualizar o nome/ícone no sistema operacional. Ícones de navegação, como Financeiro e Tarefas, mantêm seu significado funcional. O perfil comercial dos orçamentos é preenchido separadamente pelo usuário.

## Verificação

```sh
npm run test:unit
npm run test:branding:db
npm run audit:public
npm run build
```

Os testes de banco usam PostgreSQL em memória (PGlite). Não conectam a bases reais. Os testes de interface usam uma API simulada e credenciais fictícias. A auditoria procura arquivos privados, identificadores de projetos e padrões comuns de credenciais; revise também qualquer material novo antes de publicar.

Para repetir o teste de interface, execute `npm run test:branding:ui` com o Chrome instalado. Em outros sistemas, defina `CRM_TEST_CHROME` com o caminho do executável. O teste inicia e encerra seus próprios servidores locais.

## Publicação

`wrangler.jsonc` não contém domínio nem conta. Configure seu próprio Worker e suas variáveis no ambiente de hospedagem. Compile com `npm run build` antes de publicar. Use um histórico Git novo para distribuir esta base, sem importar commits ou arquivos de outras instalações.

As notificações push são opcionais. Publique a função `send-task-notifications` no seu projeto e configure `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (um contato seu) e `PUSH_CRON_SECRET` pelo gerenciador de segredos. Cadastre `push_function_url` e `push_cron_secret` no Vault do mesmo projeto para habilitar o agendamento. Não reutilize segredos de outra instalação. Sem push, o restante do CRM funciona normalmente.

Políticas RLS isolam os dados de negócio por usuário. Apenas nome e logo da instalação são expostos pela função pública de identidade; a propriedade da identidade e os demais dados não fazem parte dessa resposta.
