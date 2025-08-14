import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Odontogram } from '@portfolio/odontogram/models';

@Injectable({ providedIn: 'root' })
export class OdontogramService {
  private _http: HttpClient = inject(HttpClient);

  getList() {
    return this._http.get<Odontogram[]>('/api/odontograms');
  }

  getById(id: string) {
    return this._http.get<Odontogram>(`/api/odontograms/${id}`);
  }

  create(odontogram: Odontogram) {
    return this._http.post<Odontogram>('/api/odontograms', odontogram);
  }

  update(odontogram: Odontogram) {
    return this._http.put<Odontogram>(`/api/odontograms/${odontogram.id}`, odontogram);
  }
}
