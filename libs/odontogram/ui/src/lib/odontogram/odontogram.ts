import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tooth } from '@portfolio/odontogram/models';

@Component({
  selector: 'lib-odontogram',
  imports: [CommonModule],
  templateUrl: './odontogram.html',
  styleUrl: './odontogram.scss',
})
export class Odontogram {
  pediatricSectors = [4, 5, 6, 7];
  // Cantidad de dientes para cada sector
  sectors = [8, 8, 8, 8, 5, 5, 5, 5];
  maxTeethNumber = Math.max(...this.sectors);

  // Se convierte el array en un mapa para facilitar el acceso
  // a la hora de hacer comprobaciones aplicando los estilos
  // La key del mapa sera el numero del diente (11-18, 21-28, 31-38...)
  public teeth: { [key: number]: Tooth } = {};
}
