import { Injectable } from '@angular/core';

/**
 * A file on its way from the Runs tab to the import page (admin plan 0044,
 * target 5).
 *
 * The Runs tab has a drop zone and a "Choose a file" button, and the import
 * page is where a file is read, previewed and sent. A `File` cannot ride in an
 * address, so the tab leaves it here and navigates, and the page takes it when
 * it is built.
 *
 * **Taken once.** The page that takes the file empties this, so a later visit
 * to the import page by its address starts with no file, which is what that
 * address has always meant.
 *
 * Root scoped, because the two screens are siblings and the one that takes the
 * file is built after the one that left it is gone.
 */
@Injectable({ providedIn: 'root' })
export class ImportHandoff {
  private _file: File | null = null;

  /** Leave a file for the import page. */
  leave(file: File): void {
    this._file = file;
  }

  /** The file that was left, if any. It is gone after this call. */
  take(): File | null {
    const file = this._file;
    this._file = null;
    return file;
  }
}
