# Sprint CRM

Instalação: https://crm.sprintgrupo.workers.dev/

Cloudflare: conta `contato@sprintmidia.com.br`, Worker `crm`. O ID da conta está fixado em `wrangler.jsonc` para evitar publicação em outra conta.

O OAuth desta instalação é salvo separadamente em `.wrangler/oauth/`, ignorado pelo Git. Para renovar e publicar:

```sh
npm run cloudflare:login
npm run deploy
```

O deploy compila o projeto e configura a URL e a chave pública do Supabase a partir do arquivo local `.env`. O banco foi instalado com as 21 migrações do repositório e mantém o histórico em `supabase_migrations.schema_migrations`. O cadastro público está desativado e os redirecionamentos de autenticação usam o endereço publicado.

O Worker executa `get_crm_branding` no banco a cada seis horas, pelo Cron Trigger `0 */6 * * *` (UTC). A operação é somente leitura e usa apenas a chave pública. Falhas aparecem nos logs do Worker. O keepalive reduz o risco de pausa por inatividade; o Supabase não garante ausência de pausas no plano gratuito.

A conta inicial é `contato@sprintmidia.com.br`; a senha não é versionada. A identidade inicial é `Sprint CRM` e pode ser alterada em Configurações → Identidade visual.

Os arquivos `.env` e `.env.provision` contêm configurações locais e são ignorados pelo Git. `.env.provision` é usado somente na instalação; suas credenciais administrativas não são enviadas ao Worker nem ao navegador. O token temporário de gerenciamento expira em 24 horas.

Notificações push são opcionais e ainda não estão configuradas. O agendamento interno de envio está desativado até que a função e seus segredos sejam configurados conforme o README. Lembretes e os demais módulos do CRM continuam disponíveis.
