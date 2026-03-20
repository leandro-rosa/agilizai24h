import { Link } from "react-router";
import { Instagram, Linkedin, Mail, Phone } from "lucide-react";
import logoImage from "@/assets/logo-color-text.png";
export function Footer() {
  return (
    <footer className="bg-zinc-950 border-t border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
               <img
                          style={{ maxWidth: '250px' }}
                                    src={logoImage}
                                    alt="Agiliz.ai para Empresas"
                                    className="w-full h-full object-cover"
                                  />
            </div>
            <p className="text-gray-400 mb-4 max-w-md">
              Sua vida não para. Aqui, nem a gente. Conveniência 24h sem operação para empresas e condomínios.
            </p>
            <div className="flex gap-4">
              <a
                target="_blank"
                rel="noopener noreferrer"
                href="https://www.instagram.com/agiliz.ai24h"
                className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-pink-500 transition-colors"
              >
                <Instagram className="w-5 h-5" />
              </a>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href="https://www.linkedin.com/company/agiliz-ai/"
                className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center hover:bg-pink-500 transition-colors"
              >
                <Linkedin className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold text-white mb-4">Soluções</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/empresas"
                  className="text-gray-400 hover:text-pink-400 transition-colors"
                >
                  Para Empresas
                </Link>
              </li>
              <li>
                <Link
                  to="/condominios"
                  className="text-gray-400 hover:text-pink-400 transition-colors"
                >
                  Para Condomínios
                </Link>
              </li>
              <li>
                <Link
                  to="/produtos"
                  className="text-gray-400 hover:text-pink-400 transition-colors"
                >
                  Produtos
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold text-white mb-4">Contato</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-2 text-gray-400">
                <Mail className="w-4 h-4" />
                <span className="text-sm">barbara@agilizai24h.com</span>
              </li>
              <li className="flex items-center gap-2 text-gray-400">
                <Phone className="w-4 h-4" />
                <span className="text-sm">+55 (11) 94736-0963</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-zinc-800 mt-8 pt-8 text-center text-gray-400 text-sm">
          <p>© 2026 Agiliz.ai. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
