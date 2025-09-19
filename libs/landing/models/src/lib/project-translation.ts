export interface ProjectTranslation {
  id: string;
  projectId: string;
  locale: string;
  name: string;
  description: string;
  appLink: string;
  image: string | Promise<string>;
}
