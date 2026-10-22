import type { ErrorCode } from '../core/errors';
export const en = {
  appearance: 'Appearance', theme: 'Theme', themeSystem: 'Follow system', themeLight: 'Light', themeDark: 'Dark',
  themeHint: 'Your theme preference is saved only on this device. Follow system changes automatically with your system appearance. Forget vault resets this preference.',
  themeFailed: 'Could not load or save the theme preference. Try selecting it again.',
  library: 'YOUR WORKSPACE', vaultLocked: 'Vault locked',
  subtitle: 'Your library, within reach', loading: 'Loading…', language: 'Language', lock: 'Lock', openLibrary: 'Open full library',
  securitySettings: 'Security', automaticLock: 'Automatic locking', lockTimeout: 'After inactivity (recommended)', lockBrowser: 'Until the browser closes',
  lockTimeoutHint: 'Default: lock after 5 minutes without interaction or 30 minutes in total. Switching back to this mode starts new timeout limits.',
  lockBrowserWarning: 'Disables both timeout limits. Your credentials remain available in browser memory until you lock or the browser process ends. Closing all windows may leave it running in the background. Use only on a trusted device.',
  lockPreferenceHint: 'This non-secret preference is saved on this device. Manual lock and security-related locking still apply. Forget vault restores the default.',
  setup: 'Connect your Linkwarden', setupHint: 'Encrypt your access token on this device with a password of at least 12 characters.',
  url: 'Server URL', linkUrl: 'Link URL', token: 'Access token', password: 'Vault password', confirmPassword: 'Confirm password', saveVault: 'Create encrypted vault',
  unlock: 'Unlock your library', unlockHint: 'Your password unlocks the token locally.', unlockAction: 'Unlock', connect: 'Allow access and connect',
  connectHint: 'Confirm the server below. Connecting asks for browser permission and contacts this server.', server: 'Server', forget: 'Forget vault',
  permissionHint: 'Browser host permission may cover other ports, especially in Firefox. Requests use only the configured URL.',
  forgetConfirm: 'Forget the encrypted vault on this device? You will need your token to set it up again.', confirm: 'Confirm', cancel: 'Cancel',
  replaceToken: 'Replace token', replaceHint: 'Enter a new token and your current vault password.', save: 'Save', passwordMismatch: 'The passwords do not match.',
  allLinks: 'All links', folders: 'Folders', links: 'Links', search: 'Search links', searchAction: 'Search', newLink: 'Add link', newFolder: 'New folder',
  edit: 'Edit', delete: 'Delete', deleteConfirm: 'Delete this link from Linkwarden?', name: 'Name', description: 'Description', tags: 'Tags', addTag: 'Add tag', removeTag: 'Remove tag',
  destination: 'Destination collection', chooseDestination: 'Choose destination', root: 'Root', useDestination: 'Use this collection', shared: 'Shared',
  sharedWarning: 'This destination is shared. Other people may be able to access its contents.', noFolders: 'No subfolders here.', noLinks: 'No links found.',
  urlChangeWarning: 'Changing this URL can delete the existing archives in Linkwarden. Save only if you intend to replace the URL.',
  attachment: 'Attachment — edit in Linkwarden',
  captureFromPopup: 'Open the browser toolbar popup to capture the current page.',
  archiveWarning: 'Saving sends these fields to Linkwarden, which may fetch and archive the destination. Check the URL and collection before saving.',
  loadMore: 'Load more', editFolder: 'Rename or move folder', editLink: 'Edit or move link', success: 'Changes saved.',
  retry: 'Retry', close: 'Close', up: 'Up one level', selectCollection: 'Choose a collection to save this link.', readonly: 'Read only',
  demo: 'Synthetic demo · no production authentication', demoSetup: 'Preview setup', demoUnlocked: 'Preview library',
} as const;
export type MessageKey = keyof typeof en;
export type Catalogue = { [K in MessageKey]: string };
export const pt: Catalogue = {
  appearance: 'Aspeto', theme: 'Tema', themeSystem: 'Seguir o sistema', themeLight: 'Claro', themeDark: 'Escuro',
  themeHint: 'A preferência de tema é guardada apenas neste dispositivo. Seguir o sistema acompanha automaticamente o aspeto do sistema. Esquecer cofre repõe esta preferência.',
  themeFailed: 'Não foi possível ler ou guardar a preferência de tema. Tente selecioná-la novamente.',
  library: 'A SUA BIBLIOTECA', vaultLocked: 'Cofre bloqueado',
  subtitle: 'A sua biblioteca, sempre à mão', loading: 'A carregar…', language: 'Idioma', lock: 'Bloquear', openLibrary: 'Abrir biblioteca completa',
  securitySettings: 'Segurança', automaticLock: 'Bloqueio automático', lockTimeout: 'Após inatividade (recomendado)', lockBrowser: 'Até encerrar o navegador',
  lockTimeoutHint: 'Por defeito: bloquear após 5 minutos sem interação ou 30 minutos no total. Voltar a este modo inicia novos limites de tempo.',
  lockBrowserWarning: 'Desativa ambos os limites de tempo. As credenciais ficam disponíveis na memória do navegador até bloquear ou o processo terminar. Fechar todas as janelas pode deixá-lo a correr em segundo plano. Use apenas num dispositivo de confiança.',
  lockPreferenceHint: 'Esta preferência, sem dados pessoais, é guardada neste dispositivo. O bloqueio manual e os bloqueios por motivos de segurança continuam ativos. Esquecer cofre repõe a opção inicial.',
  setup: 'Ligar ao seu Linkwarden', setupHint: 'Cifre o token de acesso neste dispositivo com uma palavra-passe de pelo menos 12 caracteres.',
  url: 'URL do servidor', linkUrl: 'URL da ligação', token: 'Token de acesso', password: 'Palavra-passe do cofre', confirmPassword: 'Confirmar palavra-passe', saveVault: 'Criar cofre cifrado',
  unlock: 'Desbloquear a biblioteca', unlockHint: 'A palavra-passe desbloqueia o token localmente.', unlockAction: 'Desbloquear', connect: 'Permitir acesso e ligar',
  connectHint: 'Confirme o servidor abaixo. A ligação pede permissão ao navegador e contacta este servidor.', server: 'Servidor', forget: 'Esquecer cofre',
  permissionHint: 'A permissão do navegador pode abranger outras portas, sobretudo no Firefox. Os pedidos usam apenas o URL configurado.',
  forgetConfirm: 'Esquecer o cofre cifrado neste dispositivo? Precisará do token para o configurar novamente.', confirm: 'Confirmar', cancel: 'Cancelar',
  replaceToken: 'Substituir token', replaceHint: 'Introduza um novo token e a palavra-passe atual do cofre.', save: 'Guardar', passwordMismatch: 'As palavras-passe não coincidem.',
  allLinks: 'Todas as ligações', folders: 'Pastas', links: 'Ligações', search: 'Pesquisar ligações', searchAction: 'Pesquisar', newLink: 'Adicionar ligação', newFolder: 'Nova pasta',
  edit: 'Editar', delete: 'Eliminar', deleteConfirm: 'Eliminar esta ligação do Linkwarden?', name: 'Nome', description: 'Descrição', tags: 'Etiquetas', addTag: 'Adicionar etiqueta', removeTag: 'Remover etiqueta',
  destination: 'Coleção de destino', chooseDestination: 'Escolher destino', root: 'Raiz', useDestination: 'Usar esta coleção', shared: 'Partilhada',
  sharedWarning: 'Este destino é partilhado. Outras pessoas poderão aceder ao seu conteúdo.', noFolders: 'Sem subpastas.', noLinks: 'Não foram encontradas ligações.',
  urlChangeWarning: 'Alterar este URL pode eliminar os arquivos existentes no Linkwarden. Guarde apenas se pretende substituir o URL.',
  attachment: 'Anexo — edite no Linkwarden',
  captureFromPopup: 'Abra o popup na barra do navegador para obter a página atual.',
  archiveWarning: 'Guardar envia estes campos para o Linkwarden, que poderá aceder ao destino e arquivá-lo. Confirme o URL e a coleção antes de guardar.',
  loadMore: 'Carregar mais', editFolder: 'Renomear ou mover pasta', editLink: 'Editar ou mover ligação', success: 'Alterações guardadas.',
  retry: 'Tentar novamente', close: 'Fechar', up: 'Subir um nível', selectCollection: 'Escolha uma coleção para guardar esta ligação.', readonly: 'Só de leitura',
  demo: 'Demonstração sintética · sem autenticação de produção', demoSetup: 'Ver configuração', demoUnlocked: 'Ver biblioteca',
};
export const errorEn: Record<ErrorCode, string> = {
  capture_unavailable: 'This tab cannot be captured. Select an HTTP or HTTPS page and open the toolbar popup again.',
  conflict: 'This item changed on the server. Refresh and open it again before editing.', unsupported_edit: 'This item cannot be edited safely here. Use Linkwarden.',
  invalid_request: 'Check the entered values and try again.', unauthorized: 'This action is not authorized.', locked: 'The vault is locked.', session_changed: 'The session changed. Check the server before repeating a change.',
  no_vault: 'Create a vault first.', invalid_vault: 'The vault is invalid. Forget it and set it up again.', unlock_failed: 'Could not unlock. Check your password.', weak_password: 'Use at least 12 characters.',
  invalid_connection: 'Enter a valid HTTPS server URL.', permission_required: 'Browser permission is required for this server.', network: 'Could not reach the server.', timeout: 'The server took too long to respond.',
  authentication: 'The token was rejected. Replace it and reconnect.', forbidden: 'You do not have permission for this action.', not_found: 'This item no longer exists.', rate_limited: 'Too many requests. Try again later.',
  duplicate: 'This item already exists.', server: 'The server could not complete the request.', invalid_response: 'The server returned an unsupported response.', invalid_destination: 'Choose a valid destination outside this folder and its descendants.', write_uncertain: 'The result could not be confirmed. Refresh before retrying to avoid duplicates.',
};
export const errorPt: Record<ErrorCode, string> = {
  capture_unavailable: 'Não foi possível obter este separador. Selecione uma página HTTP ou HTTPS e volte a abrir o popup na barra do navegador.',
  conflict: 'Este elemento foi alterado no servidor. Atualize e volte a abri-lo antes de editar.', unsupported_edit: 'Este elemento não pode ser editado aqui em segurança. Utilize o Linkwarden.',
  invalid_request: 'Verifique os valores introduzidos e tente novamente.', unauthorized: 'Esta ação não está autorizada.', locked: 'O cofre está bloqueado.', session_changed: 'A sessão mudou. Confirme no servidor antes de repetir uma alteração.',
  no_vault: 'Crie primeiro um cofre.', invalid_vault: 'O cofre é inválido. Esqueça-o e configure-o novamente.', unlock_failed: 'Não foi possível desbloquear. Verifique a palavra-passe.', weak_password: 'Utilize pelo menos 12 caracteres.',
  invalid_connection: 'Introduza um URL HTTPS válido.', permission_required: 'É necessária permissão do navegador para este servidor.', network: 'Não foi possível contactar o servidor.', timeout: 'O servidor demorou demasiado a responder.',
  authentication: 'O token foi rejeitado. Substitua-o e volte a ligar.', forbidden: 'Não tem permissão para esta ação.', not_found: 'Este elemento já não existe.', rate_limited: 'Demasiados pedidos. Tente mais tarde.',
  duplicate: 'Este elemento já existe.', server: 'O servidor não conseguiu concluir o pedido.', invalid_response: 'O servidor devolveu uma resposta não suportada.', invalid_destination: 'Escolha um destino fora desta pasta e das suas descendentes.', write_uncertain: 'Não foi possível confirmar o resultado. Atualize antes de repetir para evitar duplicados.',
};
export type Locale = 'en' | 'pt-PT';
export function detectLocale(languages: readonly string[]): Locale { return languages[0]?.toLowerCase().startsWith('pt') ? 'pt-PT' : 'en'; }
export function messageError(error: unknown, locale: Locale): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const catalogue = locale === 'pt-PT' ? errorPt : errorEn;
  return Object.prototype.hasOwnProperty.call(catalogue, code) ? catalogue[code as ErrorCode] : catalogue.invalid_request;
}
