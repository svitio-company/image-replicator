// Kubernetes Admission Review Types

export interface AdmissionReviewRequest {
  apiVersion: string;
  kind: string;
  request: {
    uid: string;
    kind: {
      group: string;
      version: string;
      kind: string;
    };
    resource: {
      group: string;
      version: string;
      resource: string;
    };
    requestKind: {
      group: string;
      version: string;
      kind: string;
    };
    requestResource: {
      group: string;
      version: string;
      resource: string;
    };
    name?: string;
    namespace: string;
    operation: "CREATE" | "UPDATE" | "DELETE" | "CONNECT";
    userInfo: {
      username: string;
      uid: string;
      groups: string[];
    };
    object: KubernetesObject;
    oldObject?: KubernetesObject;
    dryRun: boolean;
    options?: object;
  };
}

export interface AdmissionReviewResponse {
  apiVersion: string;
  kind: string;
  response: {
    uid: string;
    allowed: boolean;
    status?: {
      code: number;
      message: string;
    };
    warnings?: string[];
  };
}

export interface KubernetesObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: PodSpec | JobSpec | CronJobSpec | DeploymentSpec | StatefulSetSpec | DaemonSetSpec | ReplicaSetSpec;
}

export interface Container {
  name: string;
  image: string;
  imagePullPolicy?: "Always" | "Never" | "IfNotPresent";
}

export interface PodSpec {
  containers: Container[];
  initContainers?: Container[];
  ephemeralContainers?: Container[];
  imagePullSecrets?: Array<{ name: string }>;
}

export interface PodTemplateSpec {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: PodSpec;
}

export interface JobSpec {
  template: PodTemplateSpec;
  backoffLimit?: number;
  completions?: number;
  parallelism?: number;
}

export interface CronJobSpec {
  jobTemplate: {
    spec: JobSpec;
  };
  schedule: string;
}

export interface DeploymentSpec {
  template: PodTemplateSpec;
  replicas?: number;
  selector?: object;
}

export interface StatefulSetSpec {
  template: PodTemplateSpec;
  replicas?: number;
  selector: object;
  serviceName: string;
}

export interface DaemonSetSpec {
  template: PodTemplateSpec;
  selector: object;
}

export interface ReplicaSetSpec {
  template: PodTemplateSpec;
  replicas?: number;
  selector: object;
}
