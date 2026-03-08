import React, { createContext, useContext, useState, useCallback } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';

export type Language = 'en' | 'fr' | 'pt';

const translations: Record<Language, Record<string, string>> = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.wallet': 'Wallet',
    'nav.send': 'Send Money',
    'nav.request': 'Request Money',
    'nav.transactions': 'Transactions',
    'nav.settings': 'Settings',
    'nav.business': 'Business',
    'nav.developers': 'Developers',
    'nav.support': 'Help & Support',
    'nav.signout': 'Sign Out',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.submit': 'Submit',
    'common.loading': 'Loading...',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.export': 'Export',
    'common.download': 'Download',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.view': 'View',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.confirm': 'Confirm',
    'common.amount': 'Amount',
    'common.status': 'Status',
    'common.date': 'Date',
    'common.description': 'Description',
    'common.noData': 'No data available',
    'wallet.balance': 'Balance',
    'wallet.deposit': 'Deposit',
    'wallet.withdraw': 'Withdraw',
    'wallet.transfer': 'Transfer',
    'payment.success': 'Payment Successful',
    'payment.failed': 'Payment Failed',
    'payment.pending': 'Payment Pending',
    'bills.airtime': 'Airtime',
    'bills.electricity': 'Electricity',
    'bills.water': 'Water',
    'bills.tv': 'TV Subscription',
    'bills.internet': 'Internet',
    'savings.title': 'Savings',
    'savings.interest': 'Interest Rate',
    'savings.earned': 'Interest Earned',
    'escrow.title': 'Marketplace Escrow',
    'escrow.release': 'Release Funds',
    'escrow.dispute': 'Dispute',
    'agents.findAgent': 'Find an Agent',
    'agents.cashIn': 'Cash In',
    'agents.cashOut': 'Cash Out',
  },
  fr: {
    'nav.dashboard': 'Tableau de bord',
    'nav.wallet': 'Portefeuille',
    'nav.send': 'Envoyer de l\'argent',
    'nav.request': 'Demander de l\'argent',
    'nav.transactions': 'Transactions',
    'nav.settings': 'Paramètres',
    'nav.business': 'Entreprise',
    'nav.developers': 'Développeurs',
    'nav.support': 'Aide & Support',
    'nav.signout': 'Déconnexion',
    'common.save': 'Sauvegarder',
    'common.cancel': 'Annuler',
    'common.submit': 'Soumettre',
    'common.loading': 'Chargement...',
    'common.search': 'Rechercher',
    'common.filter': 'Filtrer',
    'common.export': 'Exporter',
    'common.download': 'Télécharger',
    'common.delete': 'Supprimer',
    'common.edit': 'Modifier',
    'common.view': 'Voir',
    'common.back': 'Retour',
    'common.next': 'Suivant',
    'common.confirm': 'Confirmer',
    'common.amount': 'Montant',
    'common.status': 'Statut',
    'common.date': 'Date',
    'common.description': 'Description',
    'common.noData': 'Aucune donnée disponible',
    'wallet.balance': 'Solde',
    'wallet.deposit': 'Déposer',
    'wallet.withdraw': 'Retirer',
    'wallet.transfer': 'Transférer',
    'payment.success': 'Paiement réussi',
    'payment.failed': 'Paiement échoué',
    'payment.pending': 'Paiement en attente',
    'bills.airtime': 'Crédit téléphone',
    'bills.electricity': 'Électricité',
    'bills.water': 'Eau',
    'bills.tv': 'Abonnement TV',
    'bills.internet': 'Internet',
    'savings.title': 'Épargne',
    'savings.interest': 'Taux d\'intérêt',
    'savings.earned': 'Intérêts gagnés',
    'escrow.title': 'Séquestre',
    'escrow.release': 'Libérer les fonds',
    'escrow.dispute': 'Contester',
    'agents.findAgent': 'Trouver un agent',
    'agents.cashIn': 'Dépôt',
    'agents.cashOut': 'Retrait',
  },
  pt: {
    'nav.dashboard': 'Painel',
    'nav.wallet': 'Carteira',
    'nav.send': 'Enviar Dinheiro',
    'nav.request': 'Solicitar Dinheiro',
    'nav.transactions': 'Transações',
    'nav.settings': 'Configurações',
    'nav.business': 'Negócios',
    'nav.developers': 'Desenvolvedores',
    'nav.support': 'Ajuda & Suporte',
    'nav.signout': 'Sair',
    'common.save': 'Salvar',
    'common.cancel': 'Cancelar',
    'common.submit': 'Enviar',
    'common.loading': 'Carregando...',
    'common.search': 'Pesquisar',
    'common.filter': 'Filtrar',
    'common.export': 'Exportar',
    'common.download': 'Baixar',
    'common.delete': 'Excluir',
    'common.edit': 'Editar',
    'common.view': 'Ver',
    'common.back': 'Voltar',
    'common.next': 'Próximo',
    'common.confirm': 'Confirmar',
    'common.amount': 'Valor',
    'common.status': 'Status',
    'common.date': 'Data',
    'common.description': 'Descrição',
    'common.noData': 'Nenhum dado disponível',
    'wallet.balance': 'Saldo',
    'wallet.deposit': 'Depositar',
    'wallet.withdraw': 'Sacar',
    'wallet.transfer': 'Transferir',
    'payment.success': 'Pagamento bem-sucedido',
    'payment.failed': 'Pagamento falhou',
    'payment.pending': 'Pagamento pendente',
    'bills.airtime': 'Recarga',
    'bills.electricity': 'Eletricidade',
    'bills.water': 'Água',
    'bills.tv': 'Assinatura TV',
    'bills.internet': 'Internet',
    'savings.title': 'Poupança',
    'savings.interest': 'Taxa de juros',
    'savings.earned': 'Juros ganhos',
    'escrow.title': 'Custódia',
    'escrow.release': 'Liberar fundos',
    'escrow.dispute': 'Contestar',
    'agents.findAgent': 'Encontrar agente',
    'agents.cashIn': 'Depósito',
    'agents.cashOut': 'Saque',
  },
};

const languageNames: Record<Language, string> = {
  en: 'English',
  fr: 'Français',
  pt: 'Português',
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  languages: typeof languageNames;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stored, setStored] = useLocalStorage<Language>('app-language', 'en');
  const [language, setLanguageState] = useState<Language>(stored);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    setStored(lang);
  }, [setStored]);

  const t = useCallback((key: string): string => {
    return translations[language]?.[key] || translations.en[key] || key;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, languages: languageNames }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};
