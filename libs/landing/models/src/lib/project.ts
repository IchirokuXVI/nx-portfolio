import { ProjectArea } from './project-area';

export interface Project {
  id: string;
  name: string;
  description: string;
  appLink: string;
  repoLink: string;
  image: string | Promise<string>;
  // Area would be things like API, FrontEnd, database, websocket... or whatever it uses and is relevant to the progress of the project
  areas: ProjectArea[];
}
