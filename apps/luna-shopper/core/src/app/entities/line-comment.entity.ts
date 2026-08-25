import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ListLine } from './list-line.entity';

/**
 * A comment on a line (plan 0007, section 1). Any approved member of the zone may
 * comment; comments are listed newest to oldest with a fixed order.
 */
@Entity({ name: 'line_comments' })
export class LineComment extends BaseEntity {
  @Index('ix_comments_line')
  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  @Column({ type: 'uuid' })
  authorUserId!: string;

  @Column({ type: 'text' })
  body!: string;
}
