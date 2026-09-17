import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  LIST_PATTERNS,
  type ListTripRowsRequest,
  type ListTripsRequest,
  type TripPage,
  type TripRowPage,
} from '@portfolio/luna-shopper/contracts';
import { TripsService } from './trips.service';

/** The trips of a zone list, over NATS (plan 0122). Both reads need `READ`. */
@Controller()
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @MessagePattern(LIST_PATTERNS.trips)
  list(@Payload() req: ListTripsRequest): Promise<TripPage> {
    return this.trips.list(req);
  }

  @MessagePattern(LIST_PATTERNS.tripRows)
  rows(@Payload() req: ListTripRowsRequest): Promise<TripRowPage> {
    return this.trips.rows(req);
  }
}
