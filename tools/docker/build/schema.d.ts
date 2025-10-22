export interface BuildExecutorSchema {
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'project' | 'root';
  tag: string;
  noCache: boolean;
}
