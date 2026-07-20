export type NewsIcon = 'calendar' | 'home';

export interface News {
  id: string;
  /** Optional; the UI hides the icon slot entirely when omitted. */
  icon?: NewsIcon;
  image?: string | Promise<string>;
}

export interface NewsTranslation {
  id: string;
  newsId: string;
  locale: string;
  title: string;
  description: string;
}

export type TranslatedNews = News & NewsTranslation;
