import { Injectable } from '@angular/core';
import { environment } from '@portfolio/shared/environments';
import { ApiUrlResolver } from './api-url-resolver';

@Injectable({ providedIn: 'root' })
export class OwnApiUrlResolver implements ApiUrlResolver {
  private _domain: string;
  private _path: string;
  private _port: string;

  constructor() {
    this._domain = environment.BACK_API_DOMAIN;
    this._path = environment.BACK_API_PATH;
    this._port = environment.BACK_API_PORT;
  }

  getApiPath(): string {
    return this._path;
  }

  getApiDomain(): string {
    return this._domain;
  }

  getApiUrl(): string {
    return `${this.getApiDomain()}${this._port}${this.getApiPath()}`;
  }
}
