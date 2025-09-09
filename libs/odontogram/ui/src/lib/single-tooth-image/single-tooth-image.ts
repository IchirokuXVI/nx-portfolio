import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  inject,
  Input,
  input,
  OnDestroy,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import {
  Tooth,
  ToothTreatment,
  ToothTreatmentStatus,
  ToothZones,
  TreatmentType,
} from '@portfolio/odontogram/models';
import { LoadingNotifier, NgLetDirective } from '@portfolio/shared/util';
import { Subject } from 'rxjs';
import { ToothImageLoader } from '../services/tooth-image-loader';

const loadable = ['image'] as const;

@Component({
  selector: 'lib-odontogram-single-tooth-image',
  standalone: true,
  imports: [CommonModule, NgLetDirective],
  templateUrl: './single-tooth-image.html',
  styleUrl: './single-tooth-image.scss',
  providers: [
    { provide: LoadingNotifier.LOADABLE_ENTRIES, useValue: loadable },
    LoadingNotifier,
  ],
})
export class SingleToothImage implements AfterViewInit, OnDestroy {
  // Map treatment status to CSS classes
  public statusClass = new Map([
    [undefined, 'status-none'],
    [ToothTreatmentStatus.PENDING, 'status-pending'],
    [ToothTreatmentStatus.COMPLETED, 'status-finished'],
  ]);

  loadingNotf = inject(LoadingNotifier<typeof loadable>, { self: true });

  tooth = input.required<Tooth>();
  toothImages = { crown: '', lateral: '', root_mask: '', crown_mask: '' };
  @Output() selected: Subject<void> = new Subject();
  @Output() startLoadingImages = this.loadingNotf.onStartLoading('image');
  @Output() completeLoadingImages = this.loadingNotf.onCompleteLoading('image');

  @Input() showNumber = true;
  @Input() active = false;

  @ViewChildren('img') images?: QueryList<ElementRef<HTMLImageElement>>;

  _toothImageLoader = inject(ToothImageLoader);

  constructor() {
    effect(() => {
      const tooth = this.tooth();

      if (tooth.number != null) {
        this._toothImageLoader
          .loadImage(tooth.number)
          .subscribe(({ lateral, crown, root_mask, crown_mask }) => {
            this.toothImages = { lateral, crown, root_mask, crown_mask };
          });
      }
    });
  }

  ngAfterViewInit() {
    this.images?.forEach(() => this.loadingNotf.startLoading('image'));
  }

  ngOnDestroy(): void {
    this.selected.complete();
  }

  imageLoaded() {
    this.loadingNotf.completeLoading('image');
  }

  toInt(number: string) {
    return parseInt(number, 10);
  }

  /**
   * Checks if there is an implant and which status it is at.
   * @returns Status of the implant
   */
  public getToothImplantStatus() {
    return this.getToothZoneStatus(
      ToothZones.ROOT,
      (treatment) => treatment.type == TreatmentType.IMPLANT
    );
  }

  /**
   * Checks if there is an extraction and which status it is at.
   * @returns Status of the extraction
   */
  public getToothExtractionStatus() {
    return this.getToothZoneStatus(
      ToothZones.ROOT,
      (treatment) => treatment.type == TreatmentType.EXTRACTION
    );
  }

  /**
   * Checks treatments in the specified zone of the tooth and returns the current status of that zone
   * If any treatment is pending, the status will be PENDING, if all treatments are completed, the status will be COMPLETED
   * If no treatments are found, no status will be returned (undefined)
   * @param zone Name of the zone
   * @param filter Before checking the status, removes all treatments that do not meet the filter
   * @returns Status of the zone
   */
  public getToothZoneStatus(
    zone: ToothZones,
    filter?: (treatment: ToothTreatment) => boolean
  ): ToothTreatmentStatus | undefined {
    const tooth = this.tooth();

    const treatmentsZone = tooth.treatments?.filter((treatment) =>
      treatment.zones?.includes(zone)
    );

    const treatmentsFiltered = filter
      ? treatmentsZone?.filter(filter)
      : treatmentsZone;

    if (!treatmentsFiltered || treatmentsFiltered.length === 0)
      return undefined;

    let status = ToothTreatmentStatus.COMPLETED;

    for (const treatment of treatmentsFiltered) {
      if (treatment.status === ToothTreatmentStatus.PENDING) {
        status = ToothTreatmentStatus.PENDING;
        break;
      }
    }

    return status;
  }

  get toothZones() {
    return ToothZones;
  }
}
