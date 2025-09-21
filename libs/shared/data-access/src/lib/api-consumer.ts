import { ApiUrlResolver } from './api-url-resolver';

export class ApiConsumer {
  _url: string;

  constructor(private _apiUrlRes: ApiUrlResolver) {
    this._apiUrlRes = _apiUrlRes;

    this._url = this._apiUrlRes.getApiUrl();
  }
}
