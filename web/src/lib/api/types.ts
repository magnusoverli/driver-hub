import type { components, paths } from './schema';

type Json<T> = T extends { content: { 'application/json': infer Body } } ? Body : never;

/** The JSON body of a route's successful (200) response. */
export type ResponseBody<
	Path extends keyof paths,
	Method extends keyof paths[Path]
> = paths[Path][Method] extends { responses: { 200: infer Success } } ? Json<Success> : never;

export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];
