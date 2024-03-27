---
weight: 1
title: "Docker traffic Wireguard"
---
# Routing docker traffic through Wireguard
Routing internet traffic from a specific container through a wireguard container is rather easy.
Follow this page to setup a docker-compose configuration that allows you to easily route traffic through your Wireguard connection.

## 01 Setup a Wireguard client
To start of, one needs a wireguard client container that is connected to a VPN provider.
Use `docker-compose.yml` from below as example:

```YAML
version: "2.1"
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wireguard
    hostname: wireguard
    cap_add:
      - NET_ADMIN
      - SYS_MODULE #optional
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - ALLOWEDIPS=0.0.0.0/0 #optional
      - LOG_CONFS=true #optional
    volumes:
      - ./wireguard/config:/config
      - /lib/modules:/lib/modules #optional
    ports:
      - 51820:51820/udp
      - 9091:9091			# Transmission
      - 8080:8080			# Qbittorrent
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
      - net.ipv6.conf.all.disable_ipv6=0
    restart: unless-stopped
```


## 02 Setup the VPN connection
Open file `./wireguard/config/wg0.conf` and paste the config from your VPN provider.

Change the lines starting with `PostUp` and `PreDown`.
Make sure to change the variable `HOMENET` to your own local network range in CIDR format.
```Bash
PostUp = DROUTE=$(ip route | grep default | awk '{print $3}'); HOMENET=192.168.0.0/16; HOMENET2=10.0.0.0/8; HOMENET3=172.16.0.0/12; ip route add $HOMENET3 via $DROUTE;ip route add $HOMENET2 via $DROUTE; ip route add $HOMENET via $DROUTE;iptables -I OUTPUT -d $HOMENET -j ACCEPT;iptables -A OUTPUT -d $HOMENET2 -j ACCEPT; iptables -A OUTPUT -d $HOMENET3 -j ACCEPT;  iptables -A OUTPUT ! -o %i -m mark ! --mark $(wg show %i fwmark) -m addrtype ! --dst-type LOCAL -j REJECT
PreDown = HOMENET=192.168.0.0/16; HOMENET2=10.0.0.0/8; HOMENET3=172.16.0.0/12; ip route del $HOMENET3 via $DROUTE;ip route del $HOMENET2 via $DROUTE; ip route del $HOMENET via $DROUTE; iptables -D OUTPUT ! -o %i -m mark ! --mark $(wg show %i fwmark) -m addrtype ! --dst-type LOCAL -j REJECT; iptables -D OUTPUT -d $HOMENET -j ACCEPT; iptables -D OUTPUT -d $HOMENET2 -j ACCEPT; iptables -D OUTPUT -d $HOMENET3 -j ACCEPT
```
Changing the `PostUp` and `PreDown` line is crucial for routing the container traffic through the wireguard container.

## 03 Verify the VPN connection
Verify that the container is properly connected to the desired VPN provider.
Open a shell inside the wireguard client container.
Next ping a public website to retrieve your public IP address.
The addres you get back should be from your VPN provider.
Compare the IP address with your own public IP address. They should be different.
```Bash
docker exec -it wireguard sh
curl ifconfig.me
```

## 04 Connect containers to Wireguard
When adding container to your wireguard connection, you should comment out the ports section.
Add the ports to the wireguard container, as the network stack now relies on that container.
Also add the following line to the service in the compose file:
```YAML
network_mode: "container:wireguard"
```

Example transmission container:
```YAML
  transmission:
    image: lscr.io/linuxserver/transmission:latest
    container_name: transmission
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
    volumes:
      - ./transmission/data:/config
      - ./transmission/downloads:/downloads
      - ./transmission/watch:/watch
#    ports:
#      - 9091:9091
#      - 51413:51413
#      - 51413:51413/udp
    restart: unless-stopped
    network_mode: "container:wireguard"
```

Example qbittorrent container:
```YAML
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - WEBUI_PORT=8080
    volumes:
      - ./qbittorrent/config:/config
      - ./qbittorrent/downloads:/downloads
#    ports:
#      - 8080:8080
#      - 6881:6881
#      - 6881:6881/udp
    restart: unless-stopped
    network_mode: "container:wireguard"
```
Don't forget to add the ports to the Wireguard container!
