declare module "picomatch" {
  type PicomatchOptions = {
    dot?: boolean;
  };

  type Matcher = (path: string) => boolean;

  export default function picomatch(
    pattern: string | ReadonlyArray<string>,
    options?: PicomatchOptions,
  ): Matcher;
}
