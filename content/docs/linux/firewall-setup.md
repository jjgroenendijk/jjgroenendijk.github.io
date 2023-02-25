---
weight: 11
---

# Firewalld Installation

Firewalld is a firewall developed by Red Hat. The official documentation can be found [here](https://firewalld.org/documentation/). Install and activate Firewalld as follows:

```bash
sudo pacman -S firewalld
sudo systemctl enable --now firewalld
sudo systemctl status firewalld
```

The status should be: `Active: active (running)`.

## Docker networking fix

Firewalld may not play well with docker on Arch Linux. Firewalld does not assign a zone by default to the docker interface. The default configuration is to block unknown traffic. Docker does create a firewalld zone however. Here's how to fix docker networking with Firewalld:

```bash
sudo firewall-cmd --zone=docker --change-interface=docker0
sudo firewall-cmd --zone=docker --add-masquerade
# Check if containers are reachable
sudo firewall-cmd --runtime-to-permanent
sudo firewall-cmd --reload
sudo systemctl restart docker
```

Remember to restart Firewalld and Docker afterwards.

