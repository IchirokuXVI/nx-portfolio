export interface ApiUrlResolver {
  getApiPath(): string;

  getApiDomain(): string;

  getApiUrl(): string;
}
