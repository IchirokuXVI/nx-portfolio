export type NewsIcon = 'calendar' | 'home';

export interface News {
  id: string;
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
