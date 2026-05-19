declare module "*.css";
declare module "@fortawesome/fontawesome-free/css/all.min.css" {
  const css: string;
  export default css;
}
declare module "*?worker&inline" {
  const WorkerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default WorkerConstructor;
}
