import { DomainError } from '../../../shared/domain/errors.js';
import type { MenuNode } from './menu-tree.js';

export interface MenuProps {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  /** Normalized frontend route (`/hr/staffs`), or null for a menu that only groups others. */
  path: string | null;
  displayOrder: number;
  isActive: boolean;
  icon: string | null;
  landingPageIconUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuChanges {
  readonly parentId?: string | null;
  readonly name?: string;
  readonly description?: string;
  readonly path?: string | null;
  readonly displayOrder?: number;
  readonly isActive?: boolean;
  readonly icon?: string | null;
  readonly landingPageIconUrl?: string | null;
}

/**
 * Same rule the old HealthCare API used for page routes: trimmed, query and
 * fragment dropped, leading slash, no trailing slash, lower case.
 */
export function normalizeMenuPath(raw: string | null | undefined): string | null {
  let path = (raw ?? '').trim();
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut).trim();
  if (path === '' || path === '/') return null;
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/\/+$/, '').toLowerCase();
}

export class Menu {
  private constructor(private readonly props: MenuProps) {}

  static create(params: {
    id: string;
    parentId: string | null;
    name: string;
    description: string;
    path: string | null;
    displayOrder: number;
    isActive: boolean;
    icon: string | null;
    landingPageIconUrl: string | null;
    now: Date;
  }): Menu {
    const { now, ...fields } = params;
    const menu = new Menu({ ...fields, createdAt: now, updatedAt: now });
    menu.apply(fields);
    return menu;
  }

  static restore(props: MenuProps): Menu {
    return new Menu({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get parentId(): string | null {
    return this.props.parentId;
  }
  get name(): string {
    return this.props.name;
  }
  get path(): string | null {
    return this.props.path;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }

  get node(): MenuNode {
    return { id: this.id, parentId: this.parentId, path: this.path, isActive: this.isActive };
  }

  update(changes: MenuChanges, now: Date): void {
    this.apply(changes);
    this.props.updatedAt = now;
  }

  toSnapshot(): Readonly<MenuProps> {
    return { ...this.props };
  }

  private apply(changes: MenuChanges): void {
    if (changes.parentId !== undefined) {
      if (changes.parentId === this.props.id) throw new DomainError('menu_cycle', 'A menu cannot be its own parent');
      this.props.parentId = changes.parentId;
    }
    if (changes.name !== undefined) this.props.name = text(changes.name, 'name', 1, 100);
    if (changes.description !== undefined) this.props.description = text(changes.description, 'description', 0, 500);
    if (changes.path !== undefined) {
      const path = normalizeMenuPath(changes.path);
      if (path !== null && path.length > 255) throw new DomainError('invalid_menu_path', 'Menu path is too long');
      this.props.path = path;
    }
    if (changes.displayOrder !== undefined) {
      if (!Number.isInteger(changes.displayOrder) || changes.displayOrder < 0) {
        throw new DomainError('invalid_menu_display_order', 'Display order must be a non-negative integer');
      }
      this.props.displayOrder = changes.displayOrder;
    }
    if (changes.isActive !== undefined) this.props.isActive = changes.isActive;
    if (changes.icon !== undefined) this.props.icon = optionalText(changes.icon, 'icon', 100);
    if (changes.landingPageIconUrl !== undefined) {
      this.props.landingPageIconUrl = optionalText(changes.landingPageIconUrl, 'landing page icon', 500);
    }
  }
}

function text(value: string, field: string, min: number, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new DomainError(`invalid_menu_${field.replace(/ /g, '_')}`, `Menu ${field} must be ${min}-${max} characters`);
  }
  return trimmed;
}

function optionalText(value: string | null, field: string, max: number): string | null {
  if (value === null) return null;
  const trimmed = text(value, field, 0, max);
  return trimmed === '' ? null : trimmed;
}
