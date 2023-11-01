
import socket
import csv
import json

def port_scan(ip, start_port, end_port):
    open_ports = []
    for port in range(start_port, end_port + 1):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(1)
            result = s.connect_ex((ip, port))
            if result == 0:
                open_ports.append(port)
            s.close()
        except Exception as e:
            pass
    return open_ports

def service_scan(ip, open_ports):
    services = {}
    for port in open_ports:
        try:
            service = socket.getservbyport(port)
            services[port] = service
        except (OSError, socket.error):
            services[port] = "Unknown"
    return services

def save_results(filename, results, format):
    if format == "json":
        with open(filename, "w") as file:
            json.dump(results, file, indent=4)
    elif format == "csv":
        with open(filename, "w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["Port", "Service"])
            for port, service in results.items():
                writer.writerow([port, service])
    elif format == "text":
        with open(filename, "w") as file:
            for port, service in results.items():
                file.write(f"Port {port}: {service}\n")

if __name__ == "__main__":
    ip = input("Enter the IP address to scan: ")
    #ips = input("Enter a list of IP addresses to scan (comma-separated): ").split(',')
    start_port = 1
    end_port = 80  # or Scan ports from 1 to 65535
    format = input("Enter the format for saving results (csv, json, or text): ")
    
    open_ports = port_scan(ip, start_port, end_port)
    services = service_scan(ip, open_ports)

    save_results("scan_results." + format, services, format)
    print("Scan results saved to scan_results." + format)