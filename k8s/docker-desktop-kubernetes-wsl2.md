# Docker Desktop Kubernetes on WSL2 (cgroup v2)

Everything in [`README.md`](./README.md) assumes a working `docker-desktop` cluster.
This document covers the one failure that stops that cluster from ever starting on
Windows, because the cause sits below Docker and none of the obvious remedies touch
it.

## Symptom

Enabling (or resetting) Kubernetes in Docker Desktop fails. The UI shows an **HTTP
500** and **"Unable to start a cluster. Try again"**. Afterwards `kubectl` has no
context at all:

```sh
kubectl config current-context
# error: current-context is not set
```

`~/.kube/config` is left as a stub with an empty `contexts` list, and `docker ps -a`
shows no cluster node, because the failed node is deleted on the way out.

The Docker engine itself is healthy throughout. Only Kubernetes fails.

## Confirming it

Docker Desktop 4.38 and newer build the cluster with **kind**, so the real error is in
kind's log rather than anywhere in the UI:

```
%LOCALAPPDATA%\Docker\log\host\kind.log
```

The signature is a `kubeadm init` that succeeds at everything up to the kubelet, then
cannot reach the API server it just configured:

```
[kubelet-start] Starting the kubelet
I... round_trippers.go:632] "Response" verb="POST" url="https://172.18.0.2:6443/apis/rbac.authorization.k8s.io/v1/clusterrolebindings?timeout=10s" status="" milliseconds=0
   ... the same line, twice a second, for 60 seconds ...
error: error execution phase wait-control-plane: cannot obtain client without bootstrap:
  could not bootstrap the admin user in file admin.conf: unable to create ClusterRoleBinding:
  client rate limiter Wait returned an error: context deadline exceeded
 ✗ Starting control-plane
Deleted nodes: ["desktop-control-plane"]
```

Two details identify it. Certificates, kubeconfigs and static Pod manifests are all
written successfully, so this is **not** a config or certificate problem. And
`status=""` with `milliseconds=0` means the connection is refused instantly rather
than timing out, so the API server process never started listening. kind retries the
whole cluster creation about five times, then gives up and reports the 500.

## Cause

The WSL2 VM is booting with **cgroup v1** in the hybrid layout, while the node image
Docker Desktop runs (`kindest/node:v1.36.1`) requires **cgroup v2**. Kubernetes
deprecated cgroup v1 in 1.31 and the kind node images have since dropped it. The
kubelet is configured by kind with `cgroupDriver: systemd` and `cgroupRoot: /kubelet`,
cannot create those cgroups on a v1 host, and so never starts the `kube-apiserver`
static Pod.

Check which one the VM is on:

```sh
docker run --rm --privileged --pid=host alpine \
  nsenter -t 1 -m -u -n -i sh -c 'stat -fc %T /sys/fs/cgroup; cat /sys/fs/cgroup/cgroup.controllers'
```

| Output | Meaning |
| --- | --- |
| `tmpfs`, and `cgroup.controllers` does not exist | cgroup **v1** hybrid. Kubernetes will not start. |
| `cgroup2fs`, and `cgroup.controllers` lists `cpuset cpu io memory hugetlb pids rdma misc` | cgroup **v2** unified. Correct. |

On a v1 host, `/sys/fs/cgroup` is a tmpfs holding one directory per controller
(`cpu`, `memory`, `blkio`, and so on) and cgroup2 appears only as a side mount at
`/sys/fs/cgroup/unified`.

## Fix

WSL2 defaults to cgroup v1, and a machine with no `%USERPROFILE%\.wslconfig` gets that
default. Create the file (or add the line to an existing `[wsl2]` section):

```ini
# %USERPROFILE%\.wslconfig
[wsl2]
kernelCommandLine = cgroup_no_v1=all
```

`cgroup_no_v1=all` prevents the kernel from mounting any v1 controller, so WSL falls
back to a pure v2 unified hierarchy at `/sys/fs/cgroup`.

The kernel command line is only read when the VM boots, so a full restart is required.
Quitting Docker Desktop is not enough by itself:

```powershell
# 1. Quit Docker Desktop (tray icon, or taskkill /IM "Docker Desktop.exe" /F)
# 2. Stop the VM. This stops every WSL distro, not just docker-desktop.
wsl --shutdown
# 3. Start Docker Desktop again.
```

Re-run the check above. Once it reports `cgroup2fs`, Kubernetes starts on its own if
it was already enabled; otherwise enable it in **Settings > Kubernetes**. A healthy
result:

```sh
kubectl get nodes
# NAME                    STATUS   ROLES           AGE   VERSION
# desktop-control-plane   Ready    control-plane   37s   v1.36.1

kubectl get pods -A     # nine pods, all Running 1/1
```

> `kind.log` may still show `✗ Waiting ≤ 10s for control-plane = Ready` followed by
> `WARNING: Timed out waiting for Ready`. That one is harmless. kind only waits ten
> seconds and the node usually needs a few more. Trust `kubectl get nodes`.

## Notes

- **`.wslconfig` applies to the whole WSL2 utility VM**, so it affects every distro
  and not only `docker-desktop`. That is the intended outcome here, since current
  container tooling expects cgroup v2, but it is worth knowing before adding the file
  on a machine with other distros.
- **Clearing containers, images, volumes, or using "Reset Kubernetes cluster" cannot
  fix this**, which is what makes it hard to recognise. The fault is in how the WSL2
  kernel boots, one layer below anything Docker manages. Resetting simply reruns the
  same failing `kubeadm init`.
- The problem typically appears **after a Docker Desktop upgrade** rather than
  spontaneously, because the newer node image is what drops cgroup v1 support. A
  cluster that worked before an upgrade and fails after it fits this pattern.
- Recorded against Docker Desktop 4.88.1, `kindest/node:v1.36.1`, WSL 2.3.26.0,
  kernel 5.15.167.4.
