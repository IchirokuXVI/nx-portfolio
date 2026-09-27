import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

export const GEOJSON_TYPE = 'application/geo+json';

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/**
 * Files in and out of the lab: a download through a Blob, the Web Share API with the
 * file where the browser can share files, and reading a picked file.
 *
 * On Android, sharing to Drive or a chat is the easy way to move a walk to a laptop,
 * which is why Share is offered beside Download rather than instead of it: a browser
 * that answers `canShare` with yes can still fail when the share sheet opens.
 */
@Injectable()
export class WalkFiles {
  private readonly _document = inject(DOCUMENT);

  download(fileName: string, text: string, type = GEOJSON_TYPE): void {
    const win = this._document.defaultView;
    if (!win) {
      return;
    }

    const url = win.URL.createObjectURL(new win.Blob([text], { type }));
    const anchor = this._document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    this._document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked later rather than at once: some browsers start the download after the
    // click handler returns, and a revoked URL downloads nothing.
    win.setTimeout(() => win.URL.revokeObjectURL(url), 60_000);
  }

  /** Whether the browser says it can share this kind of file. */
  canShare(fileName: string, type = GEOJSON_TYPE): boolean {
    const nav = this._document.defaultView?.navigator;
    if (!nav || typeof nav.canShare !== 'function' || typeof nav.share !== 'function') {
      return false;
    }
    try {
      const probe = new File(['{}'], fileName, { type });
      return nav.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }

  /**
   * Opens the share sheet with the file. Call it straight from a tap: the browser
   * refuses a share that is not triggered by one.
   */
  async share(fileName: string, text: string, type = GEOJSON_TYPE): Promise<ShareOutcome> {
    const nav = this._document.defaultView?.navigator;
    if (!nav || typeof nav.share !== 'function') {
      return 'failed';
    }

    try {
      const file = new File([text], fileName, { type });
      await nav.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error) {
      return error instanceof DOMException && error.name === 'AbortError'
        ? 'cancelled'
        : 'failed';
    }
  }

  async read(file: File): Promise<string> {
    return file.text();
  }
}
