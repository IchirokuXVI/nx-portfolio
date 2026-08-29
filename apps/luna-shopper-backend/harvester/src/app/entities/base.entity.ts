import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Shared identity + timestamp columns for every harvester entity.
 *
 * The seam this database sits behind (plan 0038, section 4.2): the harvester
 * holds **opaque** `itemId`, `supermarketId`, `supermarketLocationId` and
 * `priceScopeId` values, never joins across the service boundary, and reads and
 * writes catalog only through NATS. There is not a single foreign key in here
 * pointing at another service's table, and there never will be.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
