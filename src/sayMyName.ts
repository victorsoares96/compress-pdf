import type { SayMyNameArgs } from '@/types';

export function sayMyName({ name }: SayMyNameArgs): string {
  return `Your name is ${name}`;
}
