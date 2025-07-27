import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  imports: [RouterModule],
  selector: 'ng-shell-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  title = 'shell';
}
